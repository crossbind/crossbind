/***************************************************************************
 * curl_easy_perform over fetch, for the crossbind WebAssembly build.
 *
 * The wasm recipe copies this file to lib/crossbind_fetch.c and includes it
 * from lib/easy.c, where easy_perform() hands every transfer to
 * crossbind_fetch_perform(); crossbind_fetch_request.c builds the request.
 * curl's own engine cannot run in this build (its multi handle needs a
 * socketpair), so schemes other than http and https fail with
 * CURLE_UNSUPPORTED_PROTOCOL.
 *
 * A worker or pthread waits with a synchronous XMLHttpRequest. The main
 * thread cannot block, so it waits with emscripten_sleep, which needs a
 * JSPI or Asyncify build; only there can a progress callback cancel a
 * request that is under way.
 ***************************************************************************/

#include <emscripten/emscripten.h>
#include <emscripten/fetch.h>
#include <emscripten/threading.h>

#include "progress.h"
#include "curlx/strparse.h"

#define FETCH_POLL_MS 5
/* curl's own engine calls the progress callback at least this often */
#define FETCH_PROGRESS_MS 1000
/* how long after a probe sleep starts it counts as never resumed */
#define FETCH_PROBE_CHECK_MS 50
/* emscripten_fetch_attr_t.requestMethod */
#define FETCH_METHOD_SIZE 32

struct fetch_request {
  CURLU *uh;
  char *url;
  char *user;
  char *passwd;
  char method[FETCH_METHOD_SIZE];
  char **headers; /* name, value, name, value, ..., NULL */
  size_t nheaders;
  const char *body;
  size_t body_len;
  struct dynbuf upload;
  int done;
  char *response_headers; /* "name: value\r\n" lines, once they arrive */
  curl_off_t size; /* the response's Content-Length, -1 when unknown */
};

#include "crossbind_fetch_request.c"

static void fetch_done(emscripten_fetch_t *fetch)
{
  ((struct fetch_request *)fetch->userData)->done = 1;
}

/* The value of the first `name` header in a block of "name: value\r\n" */
static const char *fetch_header_value(const char *all, const char *name)
{
  size_t nlen = strlen(name);
  const char *line;

  for(line = all; *line; line += strspn(line, "\r\n")) {
    if(curl_strnequal(line, name, nlen) && line[nlen] == ':')
      return line + nlen + 1;
    line += strcspn(line, "\r\n");
  }
  return NULL;
}

/* The download size as lib/http.c takes it: fetch's own total turns into
   the received size once the body is in. */
static void fetch_content_length(struct Curl_easy *data,
                                 struct fetch_request *req,
                                 unsigned short status)
{
  const char *value = fetch_header_value(req->response_headers,
                                         "Content-Length");
  curl_off_t size;

  if(status == 204 || status == 304)
    size = 0;
  else if(data->set.ignorecl || !value || curlx_str_numblanks(&value, &size))
    return;
  req->size = size;
  Curl_pgrsSetDownloadSize(data, size);
}

/* Once the response headers arrive, the request body is out */
static CURLcode fetch_responded(struct Curl_easy *data,
                                struct fetch_request *req,
                                emscripten_fetch_t *fetch)
{
  size_t len = emscripten_fetch_get_response_headers_length(fetch);

  req->response_headers = curlx_malloc(len + 1);
  if(!req->response_headers)
    return CURLE_OUT_OF_MEMORY;
  emscripten_fetch_get_response_headers(fetch, req->response_headers,
                                        len + 1);
  fetch_content_length(data, req, fetch->status);
  Curl_pgrsSetUploadCounter(data, (curl_off_t)req->body_len);
  Curl_pgrsTime(data, TIMER_POSTRANSFER);
  Curl_pgrsTime(data, TIMER_STARTTRANSFER);
  return CURLE_OK;
}

/* Brings curl's progress counters up to what fetch reports; *moved tells
   whether anything changed since the last call. */
static CURLcode fetch_count(struct Curl_easy *data, struct fetch_request *req,
                            emscripten_fetch_t *fetch, bool *moved)
{
  curl_off_t got = (curl_off_t)(fetch->dataOffset + fetch->numBytes);
  CURLcode result = CURLE_OK;

  *moved = FALSE;
  if(!req->response_headers && fetch->readyState >= 2 && fetch->status) {
    result = fetch_responded(data, req, fetch);
    *moved = TRUE;
  }
  if(got > data->progress.dl.cur_size) {
    Curl_pgrs_download_inc(data, (size_t)(got - data->progress.dl.cur_size));
    *moved = TRUE;
  }
  return result;
}

/* As in curl's own engine, progress is reported when bytes move and at least
   once a second, and a callback or a low speed limit can end the transfer. */
static CURLcode fetch_wait(struct Curl_easy *data, struct fetch_request *req,
                           emscripten_fetch_t *fetch)
{
  double reported = emscripten_get_now();
  CURLcode result = CURLE_OK;

  while(!result) {
    bool moved;

    emscripten_sleep(FETCH_POLL_MS);
    if(req->done)
      break;
    result = fetch_count(data, req, fetch, &moved);
    if(!result && (moved ||
                   emscripten_get_now() - reported >= FETCH_PROGRESS_MS)) {
      reported = emscripten_get_now();
      result = Curl_pgrsCheck(data);
    }
  }
  return result;
}

static void fetch_attributes(struct Curl_easy *data,
                             struct fetch_request *req,
                             emscripten_fetch_attr_t *attr, bool blocking)
{
  emscripten_fetch_attr_init(attr);
  memcpy(attr->requestMethod, req->method, sizeof(req->method));
  /* without REPLACE, emscripten looks every URL up in IndexedDB first */
  attr->attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY |
                     EMSCRIPTEN_FETCH_REPLACE |
                     (blocking ? EMSCRIPTEN_FETCH_SYNCHRONOUS : 0);
  /* a synchronous XMLHttpRequest takes no timeout */
  if(!blocking && data->set.timeout > 0)
    attr->timeoutMSecs = (uint32_t)CURLMIN(data->set.timeout,
                                           (timediff_t)UINT32_MAX);
  attr->requestHeaders = (const char * const *)req->headers;
  attr->requestData = req->body;
  attr->requestDataSize = req->body_len;
  attr->userData = req;
  attr->onsuccess = fetch_done;
  attr->onerror = fetch_done;
}

/* JSPI and Asyncify suspend onto one C stack: a second transfer waiting at the
   same time would overwrite the first one's frames. */
static bool fetch_waiting;
/* the id of the probe sleep under way, 0 when none */
static unsigned int fetch_probing;

/* A call that reached curl through a binding without emscripten::async()
   throws SuspendError at its probe sleep and never clears fetch_waiting. A
   live probe resumes right after its 0 ms timer, long before this runs. */
static void fetch_probe_check(void *probe)
{
  if(fetch_probing == (unsigned int)(uintptr_t)probe) {
    fetch_probing = 0;
    fetch_waiting = FALSE;
  }
}

/* Suspends once before the request leaves, so a call that cannot suspend
   fails with nothing sent. */
static void fetch_probe(void)
{
  static unsigned int probes;

  fetch_probing = ++probes;
  if(!fetch_probing)
    fetch_probing = ++probes;
  emscripten_async_call(fetch_probe_check, (void *)(uintptr_t)fetch_probing,
                        FETCH_PROBE_CHECK_MS);
  emscripten_sleep(0);
  fetch_probing = 0;
}

static CURLcode fetch_start(struct Curl_easy *data, struct fetch_request *req,
                            emscripten_fetch_attr_t *attr,
                            emscripten_fetch_t **pfetch)
{
  *pfetch = emscripten_fetch(attr, req->url);
  if(!*pfetch) {
    failf(data, "fetch could not start the request");
    return CURLE_FAILED_INIT;
  }
  return CURLE_OK;
}

static CURLcode fetch_send(struct Curl_easy *data, struct fetch_request *req,
                           emscripten_fetch_t **pfetch)
{
  emscripten_fetch_attr_t attr;
  bool blocking = !emscripten_is_main_browser_thread();
  CURLcode result;

  if(!blocking && !emscripten_has_asyncify()) {
    failf(data, "curl_easy_perform can wait for fetch only in a worker, "
          "or in a build linked with -sJSPI");
    return CURLE_NOT_BUILT_IN;
  }
  if(!blocking && fetch_waiting) {
    failf(data, "curl_easy_perform cannot wait for two transfers at once "
          "on this thread");
    return CURLE_RECURSIVE_API_CALL;
  }
  /* curl reports progress once before a request leaves */
  result = Curl_pgrsCheck(data);
  if(result)
    return result;
  fetch_attributes(data, req, &attr, blocking);
  Curl_pgrsTime(data, TIMER_PRETRANSFER);
  if(blocking)
    return fetch_start(data, req, &attr, pfetch);
  fetch_waiting = TRUE;
  fetch_probe();
  result = fetch_start(data, req, &attr, pfetch);
  if(!result)
    result = fetch_wait(data, req, *pfetch);
  fetch_waiting = FALSE;
  if(result && *pfetch) {
    /* closing an unfinished fetch aborts its XMLHttpRequest */
    emscripten_fetch_close(*pfetch);
    *pfetch = NULL;
  }
  return result;
}

static CURLcode fetch_client_write(struct Curl_easy *data,
                                   curl_write_callback cb, void *userp,
                                   const char *buf, size_t len)
{
  size_t nwritten = cb((char *)CURL_UNCONST(buf), 1, len, userp);

  if(nwritten == CURL_WRITEFUNC_PAUSE) {
    failf(data, "Write callback asked for PAUSE when not supported");
    return CURLE_WRITE_ERROR;
  }
  if(nwritten == CURL_WRITEFUNC_ERROR) {
    failf(data, "client returned ERROR on write of %zu bytes", len);
    return CURLE_WRITE_ERROR;
  }
  if(nwritten != len) {
    failf(data, "Failure writing output to destination, "
          "passed %zu returned %zu", len, nwritten);
    return CURLE_WRITE_ERROR;
  }
  return CURLE_OK;
}

/* Where lib/cw-out.c sends a header line */
static CURLcode fetch_write_header(struct Curl_easy *data,
                                   const char *line, size_t len)
{
  curl_write_callback cb = data->set.fwrite_header ? data->set.fwrite_header :
    (data->set.writeheader ? data->set.fwrite_func : NULL);
  CURLcode result = CURLE_OK;

  if(data->set.include_header)
    result = fetch_client_write(data, data->set.fwrite_func, data->set.out,
                                line, len);
  if(!result && cb)
    result = fetch_client_write(data, cb, data->set.writeheader, line, len);
  return result;
}

static CURLcode fetch_write_line(struct Curl_easy *data, char *line)
{
  CURLcode result = CURLE_OUT_OF_MEMORY;

  if(line)
    result = fetch_write_header(data, line, strlen(line));
  curl_free(line);
  return result;
}

/* fetch reports no protocol version, so the status line names HTTP/1.1 */
static CURLcode fetch_write_headers(struct Curl_easy *data,
                                    struct fetch_request *req,
                                    emscripten_fetch_t *fetch)
{
  const char *line;
  CURLcode result;

  if(!data->set.include_header && !data->set.fwrite_header &&
     !data->set.writeheader)
    return CURLE_OK;
  result = fetch_write_line(data, curl_maprintf("HTTP/1.1 %u %s\r\n",
                                                fetch->status,
                                                fetch->statusText));
  for(line = req->response_headers; !result && *line;) {
    size_t n = strcspn(line, "\r\n");
    if(n)
      result = fetch_write_line(data, curl_maprintf("%.*s\r\n", (int)n, line));
    line += n;
    line += strspn(line, "\r\n");
  }
  if(!result)
    result = fetch_write_header(data, STRCONST("\r\n"));
  return result;
}

/* Like lib/sendf.c, a CURLOPT_MAXFILESIZE body is delivered up to the limit
   before the transfer fails. */
static CURLcode fetch_write_body(struct Curl_easy *data,
                                 const char *buf, size_t len)
{
  curl_off_t max = data->set.max_filesize;
  size_t allowed = max ? curlx_sotouz_range(max, 0, len) : len;
  size_t left = allowed;
  CURLcode result = CURLE_OK;

  while(left && !result) {
    size_t n = CURLMIN(left, CURL_MAX_WRITE_SIZE);
    result = fetch_client_write(data, data->set.fwrite_func, data->set.out,
                                buf, n);
    buf += n;
    left -= n;
  }
  if(!result && allowed < len) {
    failf(data, "Exceeded the maximum allowed file size "
          "(%" FMT_OFF_T ") with %" FMT_OFF_T " bytes",
          max, (curl_off_t)allowed);
    result = CURLE_FILESIZE_EXCEEDED;
  }
  return result;
}

/* Status 0 is all fetch reports for a refused connection, a CORS refusal
   and a timeout alike. */
static CURLcode fetch_failed(struct Curl_easy *data, double started)
{
  double elapsed = emscripten_get_now() - started;

  if(data->set.timeout > 0 && elapsed >= (double)data->set.timeout) {
    failf(data, "Operation timed out after %.0f milliseconds "
          "with 0 bytes received", elapsed);
    return CURLE_OPERATION_TIMEDOUT;
  }
  failf(data, "Could not connect: fetch failed (network error, CORS or a "
        "blocked request)");
  return CURLE_COULDNT_CONNECT;
}

static CURLcode fetch_receive(struct Curl_easy *data,
                              struct fetch_request *req,
                              emscripten_fetch_t *fetch, double started)
{
  bool moved;
  CURLcode result = fetch_count(data, req, fetch, &moved);

  if(result)
    return result;
  data->info.httpcode = fetch->status;
  if(!fetch->status)
    return fetch_failed(data, started);
  /* lib/http.c fails on the status, then on the size, after the headers
     went out */
  result = fetch_write_headers(data, req, fetch);
  if(!result && data->set.http_fail_on_error && fetch->status >= 400) {
    failf(data, "The requested URL returned error: %u", fetch->status);
    result = CURLE_HTTP_RETURNED_ERROR;
  }
  if(!result && data->set.max_filesize &&
     req->size > data->set.max_filesize) {
    failf(data, "Maximum file size exceeded");
    result = CURLE_FILESIZE_EXCEEDED;
  }
  if(!result && !data->set.opt_no_body)
    result = fetch_write_body(data, fetch->data, (size_t)fetch->numBytes);
  return result;
}

/* As lib/multi.c multi_done(): a transfer that got a response ends with a
   last progress call, unless a callback already aborted it. */
static CURLcode fetch_finish(struct Curl_easy *data,
                             emscripten_fetch_t *fetch, CURLcode result)
{
  if(!fetch->status || result == CURLE_ABORTED_BY_CALLBACK) {
    Curl_pgrsUpdate_nometer(data);
    return result;
  }
  if(Curl_pgrsDone(data) && !result)
    result = CURLE_ABORTED_BY_CALLBACK;
  return result;
}

static CURLcode crossbind_fetch_perform(struct Curl_easy *data)
{
  struct fetch_request req;
  emscripten_fetch_t *fetch = NULL;
  double started;
  CURLcode result;

  memset(&req, 0, sizeof(req));
  req.size = -1;
  curlx_dyn_init(&req.upload, MAX_DYNBUF_SIZE);
  /* what Curl_pretransfer resets for curl's own transfers */
  Curl_initinfo(data);
  Curl_pgrsResetTransferSizes(data);
  Curl_pgrsStart(data, NULL);
  data->state.errorbuf = FALSE;

  result = fetch_prepare(data, &req);
  if(!result)
    Curl_pgrsSetUploadSize(data, (curl_off_t)req.body_len);
  started = emscripten_get_now();
  if(!result)
    result = fetch_send(data, &req, &fetch);
  if(!result)
    result = fetch_receive(data, &req, fetch, started);
  if(fetch) {
    result = fetch_finish(data, fetch, result);
    emscripten_fetch_close(fetch);
  }
  else
    Curl_pgrsUpdate_nometer(data);
  fetch_request_free(&req);
  return result;
}

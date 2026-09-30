/***************************************************************************
 * The request half of the crossbind fetch transport: the URL, method, body
 * and headers curl would send, from the easy handle's options.
 *
 * The wasm recipe copies this file to lib/crossbind_fetch_request.c;
 * crossbind_fetch.c includes it after struct fetch_request.
 ***************************************************************************/

#include "escape.h"
#include "urlapi-int.h"
#include "curlx/base64.h"

/* Content-Type, Range, Authorization and User-Agent, next to the custom
   headers */
#define FETCH_DEFAULT_HEADERS 4

static bool fetch_is_token(const char *s, size_t len)
{
  size_t i;

  if(!len)
    return FALSE;
  for(i = 0; i < len; i++) {
    unsigned char c = (unsigned char)s[i];
    if(!ISALNUM(c) && (!c || !strchr("!#$%&'*+-.^_`|~", c)))
      return FALSE;
  }
  return TRUE;
}

/* XMLHttpRequest takes header values as ByteStrings decoded from UTF-8, so
   only ASCII arrives byte for byte */
static bool fetch_is_value(const char *s, size_t len)
{
  size_t i;

  for(i = 0; i < len; i++) {
    unsigned char c = (unsigned char)s[i];
    if(c != '\t' && (c < 0x20 || c > 0x7e))
      return FALSE;
  }
  return TRUE;
}

/* The URL the way lib/url.c resolves CURLOPT_CURLU, CURLOPT_URL and
   CURLOPT_DEFAULT_PROTOCOL */
static CURLcode fetch_parse_url(struct Curl_easy *data,
                                struct fetch_request *req)
{
  const char *url = CURL_EASY_STR(data, STRING_SET_URL);
  const char *proto = CURL_EASY_STR(data, STRING_DEFAULT_PROTOCOL);
  char *absolute = NULL;
  CURLUcode uc;

  if(data->set.uh) {
    req->uh = curl_url_dup(data->set.uh);
    return req->uh ? CURLE_OK : CURLE_OUT_OF_MEMORY;
  }
  if(!url) {
    failf(data, "No URL set");
    return CURLE_URL_MALFORMAT;
  }
  req->uh = curl_url();
  if(!req->uh)
    return CURLE_OUT_OF_MEMORY;
  if(proto && !Curl_is_absolute_url(url, NULL, 0, TRUE)) {
    absolute = curl_maprintf("%s://%s", proto, url);
    if(!absolute)
      return CURLE_OUT_OF_MEMORY;
    url = absolute;
  }
  uc = curl_url_set(req->uh, CURLUPART_URL, url,
                    CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME |
                    (data->set.disallow_username_in_url ?
                     CURLU_DISALLOW_USER : 0) |
                    (data->set.path_as_is ? CURLU_PATH_AS_IS : 0));
  curl_free(absolute);
  if(uc) {
    failf(data, "URL rejected: %s", curl_url_strerror(uc));
    return Curl_uc_to_curlcode(uc);
  }
  return CURLE_OK;
}

static CURLcode fetch_check_scheme(struct Curl_easy *data, CURLU *uh)
{
  char *scheme = NULL;
  CURLcode result = CURLE_OK;
  CURLUcode uc = curl_url_get(uh, CURLUPART_SCHEME, &scheme, 0);

  if(uc) {
    failf(data, "URL rejected: %s", curl_url_strerror(uc));
    result = Curl_uc_to_curlcode(uc);
  }
  else if(!curl_strequal(scheme, "http") && !curl_strequal(scheme, "https")) {
    failf(data, "Protocol \"%s\" is not supported by the fetch transport",
          scheme);
    result = CURLE_UNSUPPORTED_PROTOCOL;
  }
  curl_free(scheme);
  return result;
}

static CURLcode fetch_url_part(struct Curl_easy *data, CURLU *uh,
                               CURLUPart what, char **pvalue)
{
  char *raw = NULL;
  CURLcode result = CURLE_OK;

  if(!curl_url_get(uh, what, &raw, 0)) {
    result = Curl_urldecode(raw, 0, pvalue, NULL, REJECT_ZERO);
    if(result)
      failf(data, "error extracting credentials from URL");
  }
  curl_free(raw);
  return result;
}

/* Credentials as lib/url.c merges them: a CURLOPT_USERNAME wins, otherwise
   the URL's user and password win over CURLOPT_PASSWORD. */
static CURLcode fetch_credentials(struct Curl_easy *data,
                                  struct fetch_request *req)
{
  const char *user = CURL_EASY_STR(data, STRING_USERNAME);
  const char *passwd = CURL_EASY_STR(data, STRING_PASSWORD);
  CURLcode result = CURLE_OK;

  if(!user) {
    result = fetch_url_part(data, req->uh, CURLUPART_USER, &req->user);
    if(!result)
      result = fetch_url_part(data, req->uh, CURLUPART_PASSWORD,
                              &req->passwd);
    if(result || req->passwd)
      return result;
  }
  if(user) {
    req->user = curlx_strdup(user);
    if(!req->user)
      return CURLE_OUT_OF_MEMORY;
  }
  if(passwd) {
    req->passwd = curlx_strdup(passwd);
    if(!req->passwd)
      return CURLE_OUT_OF_MEMORY;
  }
  return CURLE_OK;
}

/* A raw byte past ASCII goes out as %XX: left raw, a page's encoding decides
   how the browser escapes it in a query. */
static CURLcode fetch_ascii_url(char **purl)
{
  const unsigned char *p = (const unsigned char *)*purl;
  struct dynbuf out;
  CURLcode result = CURLE_OK;

  while(*p && *p < 0x80)
    p++;
  if(!*p)
    return CURLE_OK;
  curlx_dyn_init(&out, CURL_MAX_INPUT_LENGTH);
  for(p = (const unsigned char *)*purl; *p && !result; p++)
    result = (*p < 0x80) ? curlx_dyn_addn(&out, p, 1) :
                           curlx_dyn_addf(&out, "%%%02X", *p);
  if(result)
    return result;
  curl_free(*purl);
  *purl = curlx_dyn_ptr(&out);
  return CURLE_OK;
}

/* Credentials travel in the Authorization header and fragments stay local,
   as they do in curl's own requests. */
static CURLcode fetch_request_url(struct Curl_easy *data,
                                  struct fetch_request *req)
{
  CURLUcode uc = curl_url_set(req->uh, CURLUPART_USER, NULL, 0);

  if(!uc)
    uc = curl_url_set(req->uh, CURLUPART_PASSWORD, NULL, 0);
  if(!uc)
    uc = curl_url_set(req->uh, CURLUPART_FRAGMENT, NULL, 0);
  if(!uc && data->set.use_port) {
    char port[16];
    curl_msnprintf(port, sizeof(port), "%u", (unsigned int)data->set.use_port);
    uc = curl_url_set(req->uh, CURLUPART_PORT, port, 0);
  }
  if(!uc)
    uc = curl_url_get(req->uh, CURLUPART_URL, &req->url, CURLU_GET_EMPTY);
  if(uc) {
    failf(data, "URL rejected: %s", curl_url_strerror(uc));
    return Curl_uc_to_curlcode(uc);
  }
  return fetch_ascii_url(&req->url);
}

static CURLcode fetch_method(struct Curl_easy *data, char *method)
{
  const char *name = CURL_EASY_STR(data, STRING_CUSTOMREQUEST);
  size_t len;

  if(!name) {
    switch(data->set.method) {
    case HTTPREQ_POST:
    case HTTPREQ_POST_FORM:
    case HTTPREQ_POST_MIME:
      name = "POST";
      break;
    case HTTPREQ_PUT:
      name = "PUT";
      break;
    case HTTPREQ_HEAD:
      name = "HEAD";
      break;
    default:
      name = "GET";
      break;
    }
  }
  len = strlen(name);
  /* XMLHttpRequest refuses CONNECT, TRACE and TRACK */
  if(len >= FETCH_METHOD_SIZE || !fetch_is_token(name, len) ||
     curl_strequal(name, "CONNECT") || curl_strequal(name, "TRACE") ||
     curl_strequal(name, "TRACK")) {
    failf(data, "The fetch transport cannot send the method \"%s\"", name);
    return CURLE_NOT_BUILT_IN;
  }
  memcpy(method, name, len + 1);
  return CURLE_OK;
}

static CURLcode fetch_read_status(struct Curl_easy *data, size_t nread,
                                  size_t want)
{
  if(nread == CURL_READFUNC_ABORT) {
    failf(data, "operation aborted by callback");
    return CURLE_ABORTED_BY_CALLBACK;
  }
  if(nread == CURL_READFUNC_PAUSE) {
    failf(data, "Read callback asked for PAUSE when not supported");
    return CURLE_READ_ERROR;
  }
  if(nread > want) {
    failf(data, "read function returned funny value");
    return CURLE_READ_ERROR;
  }
  return CURLE_OK;
}

/* The request body from CURLOPT_READFUNCTION: `size` bytes, or up to the
   callback's end when the size is unknown (-1). */
static CURLcode fetch_read_body(struct Curl_easy *data,
                                struct fetch_request *req, curl_off_t size)
{
  size_t chunk = data->set.upload_buffer_size;
  char *buf = curlx_malloc(chunk);
  CURLcode result = buf ? CURLE_OK : CURLE_OUT_OF_MEMORY;

  while(!result) {
    curl_off_t have = (curl_off_t)curlx_dyn_len(&req->upload);
    size_t want = chunk;
    size_t nread;

    if(size >= 0 && have >= size)
      break;
    if(size >= 0 && size - have < (curl_off_t)want)
      want = (size_t)(size - have);
    nread = data->set.fread_func_set(buf, 1, want, data->set.in_set);
    if(!nread) {
      if(size >= 0) {
        failf(data, "client read function EOF fail, only "
              "%" FMT_OFF_T "/%" FMT_OFF_T " of needed bytes read",
              have, size);
        result = CURLE_READ_ERROR;
      }
      break;
    }
    result = fetch_read_status(data, nread, want);
    if(!result)
      result = curlx_dyn_addn(&req->upload, buf, nread);
  }
  curlx_free(buf);
  req->body = curlx_dyn_ptr(&req->upload);
  req->body_len = curlx_dyn_len(&req->upload);
  return result;
}

static CURLcode fetch_body(struct Curl_easy *data, struct fetch_request *req)
{
  const char *fields = data->set.postfields;
  curl_off_t size = data->set.postfieldsize;

  if(data->set.set_resume_from) {
    failf(data, "The fetch transport cannot resume a transfer");
    return CURLE_NOT_BUILT_IN;
  }
  switch(data->set.method) {
  case HTTPREQ_POST_FORM:
  case HTTPREQ_POST_MIME:
    failf(data, "The fetch transport cannot send multipart form posts");
    return CURLE_NOT_BUILT_IN;
  case HTTPREQ_PUT:
    return fetch_read_body(data, req, data->set.filesize);
  case HTTPREQ_POST:
    if(!fields)
      return fetch_read_body(data, req, size);
    req->body = fields;
    if(size < 0) {
      req->body_len = strlen(fields);
      return CURLE_OK;
    }
    /* lib/http.c refuses a size past the address space the same way */
    req->body_len = curlx_sotouz_range(size, 0, SIZE_MAX);
    return (req->body_len == SIZE_MAX) ? CURLE_OUT_OF_MEMORY : CURLE_OK;
  default:
    return CURLE_OK;
  }
}

static CURLcode fetch_add_header(struct Curl_easy *data,
                                 struct fetch_request *req,
                                 const char *name, size_t nlen,
                                 const char *value, size_t vlen)
{
  char *n;
  char *v;

  if(!fetch_is_token(name, nlen) || !fetch_is_value(value, vlen)) {
    failf(data, "The fetch transport cannot send the header \"%.*s\"",
          (int)nlen, name);
    return CURLE_NOT_BUILT_IN;
  }
  n = curlx_memdup0(name, nlen);
  v = curlx_memdup0(value, vlen);
  if(!n || !v) {
    curlx_free(n);
    curlx_free(v);
    return CURLE_OUT_OF_MEMORY;
  }
  req->headers[req->nheaders++] = n;
  req->headers[req->nheaders++] = v;
  return CURLE_OK;
}

static void fetch_trim(const char **start, const char **end)
{
  while(*start < *end && ISBLANK(**start))
    (*start)++;
  while(*end > *start && ISBLANK((*end)[-1]))
    (*end)--;
}

/* A CURLOPT_HTTPHEADER line as Curl_add_custom_headers reads it: "Name;"
   sends an empty header, "Name:" with nothing after it sends none. */
static CURLcode fetch_custom_header(struct Curl_easy *data,
                                    struct fetch_request *req,
                                    const char *line)
{
  const char *semi = strchr(line, ';');
  const char *colon = strchr(line, ':');
  const char *name = line;
  const char *name_end;
  const char *value;
  const char *value_end;

  if(semi && semi != line && !semi[1] && !colon) {
    name_end = semi;
    fetch_trim(&name, &name_end);
    return fetch_add_header(data, req, name, (size_t)(name_end - name),
                            "", 0);
  }
  if(!colon || colon == line)
    return CURLE_OK;
  value = colon + 1;
  value_end = value + strcspn(value, "\r\n");
  fetch_trim(&value, &value_end);
  if(value == value_end)
    return CURLE_OK;
  name_end = colon;
  fetch_trim(&name, &name_end);
  return fetch_add_header(data, req, name, (size_t)(name_end - name),
                          value, (size_t)(value_end - value));
}

static CURLcode fetch_add_formatted(struct Curl_easy *data,
                                    struct fetch_request *req,
                                    const char *name, char *value)
{
  CURLcode result = CURLE_OUT_OF_MEMORY;

  if(value)
    result = fetch_add_header(data, req, name, strlen(name),
                              value, strlen(value));
  curl_free(value);
  return result;
}

static CURLcode fetch_range_header(struct Curl_easy *data,
                                   struct fetch_request *req)
{
  const char *range = CURL_EASY_STR(data, STRING_SET_RANGE);

  if(!range || Curl_checkheaders(data, STRCONST("Range")))
    return CURLE_OK;
  if(data->set.method != HTTPREQ_GET && data->set.method != HTTPREQ_HEAD) {
    failf(data, "The fetch transport cannot send a range with a request body");
    return CURLE_NOT_BUILT_IN;
  }
  return fetch_add_formatted(data, req, "Range",
                             curl_maprintf("bytes=%s", range));
}

static CURLcode fetch_basic_header(struct Curl_easy *data,
                                   struct fetch_request *req)
{
  char *pair = curl_maprintf("%s:%s", req->user,
                             req->passwd ? req->passwd : "");
  char *encoded = NULL;
  size_t len;
  CURLcode result = CURLE_OUT_OF_MEMORY;

  if(pair)
    result = curlx_base64_encode((uint8_t *)pair, strlen(pair),
                                 &encoded, &len);
  if(!result)
    result = fetch_add_formatted(data, req, "Authorization",
                                 curl_maprintf("Basic %s", encoded));
  curl_free(pair);
  curlx_free(encoded);
  return result;
}

/* A single wanted method is sent up front, as curl does. Negotiating one
   needs WWW-Authenticate, which CORS hides from the page. */
static CURLcode fetch_auth_header(struct Curl_easy *data,
                                  struct fetch_request *req)
{
  unsigned long want = data->set.httpauth & ~CURLAUTH_ONLY;
  const char *bearer = CURL_EASY_STR(data, STRING_BEARER);

  if(Curl_checkheaders(data, STRCONST("Authorization")))
    return CURLE_OK;
  if(want == CURLAUTH_BASIC)
    return req->user ? fetch_basic_header(data, req) : CURLE_OK;
  if(want == CURLAUTH_BEARER)
    return bearer ? fetch_add_formatted(data, req, "Authorization",
                                        curl_maprintf("Bearer %s", bearer)) :
                    CURLE_OK;
  if(req->user || bearer) {
    failf(data, "The fetch transport sends credentials only with "
          "CURLAUTH_BASIC or CURLAUTH_BEARER");
    return CURLE_NOT_BUILT_IN;
  }
  return CURLE_OK;
}

/* Chromium drops a User-Agent header; WebKit and Node send it */
static CURLcode fetch_agent_header(struct Curl_easy *data,
                                   struct fetch_request *req)
{
  const char *agent = CURL_EASY_STR(data, STRING_USERAGENT);

  if(!agent || !*agent || Curl_checkheaders(data, STRCONST("User-Agent")))
    return CURLE_OK;
  return fetch_add_header(data, req, STRCONST("User-Agent"),
                          agent, strlen(agent));
}

static CURLcode fetch_headers(struct Curl_easy *data,
                              struct fetch_request *req)
{
  struct curl_slist *h;
  size_t count = FETCH_DEFAULT_HEADERS;
  CURLcode result = CURLE_OK;

  for(h = data->set.headers; h; h = h->next)
    count++;
  req->headers = curlx_calloc(count * 2 + 1, sizeof(char *));
  if(!req->headers)
    return CURLE_OUT_OF_MEMORY;
  for(h = data->set.headers; h && !result; h = h->next)
    result = fetch_custom_header(data, req, h->data);
  if(!result && data->set.method == HTTPREQ_POST &&
     !Curl_checkheaders(data, STRCONST("Content-Type")))
    result = fetch_add_header(data, req, STRCONST("Content-Type"),
                              STRCONST("application/x-www-form-urlencoded"));
  if(!result)
    result = fetch_range_header(data, req);
  if(!result)
    result = fetch_auth_header(data, req);
  if(!result)
    result = fetch_agent_header(data, req);
  return result;
}

static CURLcode fetch_prepare(struct Curl_easy *data,
                              struct fetch_request *req)
{
  CURLcode result = fetch_parse_url(data, req);

  if(!result)
    result = fetch_check_scheme(data, req->uh);
  if(!result)
    result = fetch_credentials(data, req);
  if(!result)
    result = fetch_request_url(data, req);
  if(!result)
    result = fetch_method(data, req->method);
  if(!result)
    result = fetch_body(data, req);
  if(!result)
    result = fetch_headers(data, req);
  return result;
}

static void fetch_request_free(struct fetch_request *req)
{
  size_t i;

  for(i = 0; i < req->nheaders; i++)
    curlx_free(req->headers[i]);
  curlx_free(req->headers);
  curlx_dyn_free(&req->upload);
  curlx_free(req->user);
  curlx_free(req->passwd);
  curlx_free(req->response_headers);
  curl_free(req->url);
  curl_url_cleanup(req->uh);
}

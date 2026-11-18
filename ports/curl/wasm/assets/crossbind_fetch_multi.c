/***************************************************************************
 * The multi interface over fetch, for the crossbind WebAssembly build.
 *
 * curl's own engine has no sockets in this build, so a transfer its multi
 * handle ran could never connect. The wasm recipe copies this file to
 * lib/crossbind_fetch_multi.c and includes it from lib/multi.c, where the
 * public calls hand over inside their API guards: a transfer that is added
 * waits in the multi handle's list, and curl_multi_perform() runs each one
 * through curl_easy_perform(), which crossbind_fetch.c sends through fetch.
 *
 * A multi handle's transfers therefore run one after another, in the order
 * they were added, and all of them are done when curl_multi_perform()
 * returns: nothing is under way between two calls. The guards refuse a call
 * that adds or removes a transfer while one runs, so the list stays as it is
 * until then. The socket interface (curl_multi_socket_action) and
 * curl_multi_get_handles() are curl's own and know nothing of the list.
 ***************************************************************************/

struct crossbind_multi_xfer {
  struct crossbind_multi_xfer *next;
  CURL *easy;
  CURLMsg msg; /* what curl_multi_info_read() hands out */
  BIT(done); /* the transfer ran */
  BIT(reported); /* its message was read */
};

static CURLMcode crossbind_multi_add(struct Curl_multi *multi, CURL *easy)
{
  struct crossbind_multi_xfer **link = &multi->crossbind_xfers;
  struct crossbind_multi_xfer *xfer;

  for(; *link; link = &(*link)->next) {
    if((*link)->easy == easy)
      return CURLM_ADDED_ALREADY;
  }
  xfer = curlx_calloc(1, sizeof(*xfer));
  if(!xfer)
    return CURLM_OUT_OF_MEMORY;
  xfer->easy = easy;
  *link = xfer;
  return CURLM_OK;
}

/* As in curl, a handle the multi handle does not hold is fine to remove. */
static CURLMcode crossbind_multi_remove(struct Curl_multi *multi, CURL *easy)
{
  struct crossbind_multi_xfer **link = &multi->crossbind_xfers;

  for(; *link; link = &(*link)->next) {
    if((*link)->easy == easy) {
      struct crossbind_multi_xfer *xfer = *link;

      *link = xfer->next;
      curlx_free(xfer);
      break;
    }
  }
  return CURLM_OK;
}

static CURLMcode crossbind_multi_perform(struct Curl_multi *multi,
                                         int *running_handles)
{
  struct crossbind_multi_xfer *xfer;

  for(xfer = multi->crossbind_xfers; xfer; xfer = xfer->next) {
    if(xfer->done)
      continue;
    xfer->msg.msg = CURLMSG_DONE;
    xfer->msg.easy_handle = xfer->easy;
    xfer->msg.data.result = curl_easy_perform(xfer->easy);
    xfer->done = TRUE;
  }
  if(running_handles)
    *running_handles = 0;
  return CURLM_OK;
}

/* Nothing is under way between two calls, so there is nothing to wait for. */
static CURLMcode crossbind_multi_wait(int *numfds)
{
  if(numfds)
    *numfds = 0;
  return CURLM_OK;
}

/* The next finished transfer's message, and how many more wait to be read. */
static CURLMsg *crossbind_multi_info_read(struct Curl_multi *multi,
                                          int *msgs_in_queue)
{
  struct crossbind_multi_xfer *xfer;
  CURLMsg *msg = NULL;

  for(xfer = multi->crossbind_xfers; xfer; xfer = xfer->next) {
    if(!xfer->done || xfer->reported)
      continue;
    if(msg) {
      ++*msgs_in_queue;
      continue;
    }
    xfer->reported = TRUE;
    msg = &xfer->msg;
  }
  return msg;
}

static void crossbind_multi_forget(struct Curl_multi *multi)
{
  while(multi->crossbind_xfers) {
    struct crossbind_multi_xfer *xfer = multi->crossbind_xfers;

    multi->crossbind_xfers = xfer->next;
    curlx_free(xfer);
  }
}

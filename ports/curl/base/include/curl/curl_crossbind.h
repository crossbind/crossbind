/* Typed forms of libcurl's variadic calls, added by crossbind: JavaScript bindings cannot pass C varargs, so each
 * argument type gets a function of its own. The option or info constant still decides what the value means. */
#ifndef CURL_CROSSBIND_H
#define CURL_CROSSBIND_H

#include <curl/curl.h>

/* C linkage, as in curl.h, is what lets the bindings take a JavaScript function for the callback typedefs. */
#ifdef __cplusplus
extern "C" {
#endif

static inline CURLcode curl_easy_setopt_long(CURL *curl, CURLoption option, long value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_offset(CURL *curl, CURLoption option, curl_off_t value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_string(CURL *curl, CURLoption option, const char *value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_pointer(CURL *curl, CURLoption option, void *value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_slist(CURL *curl, CURLoption option, struct curl_slist *value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_write_function(CURL *curl, CURLoption option, curl_write_callback value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_read_function(CURL *curl, CURLoption option, curl_read_callback value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_setopt_xferinfo_function(CURL *curl, CURLoption option, curl_xferinfo_callback value)
{
    return curl_easy_setopt(curl, option, value);
}

static inline CURLcode curl_easy_getinfo_long(CURL *curl, CURLINFO info, long *value)
{
    return curl_easy_getinfo(curl, info, value);
}

static inline CURLcode curl_easy_getinfo_offset(CURL *curl, CURLINFO info, curl_off_t *value)
{
    return curl_easy_getinfo(curl, info, value);
}

static inline CURLcode curl_easy_getinfo_double(CURL *curl, CURLINFO info, double *value)
{
    return curl_easy_getinfo(curl, info, value);
}

static inline CURLcode curl_easy_getinfo_string(CURL *curl, CURLINFO info, char **value)
{
    return curl_easy_getinfo(curl, info, value);
}

static inline CURLcode curl_easy_getinfo_slist(CURL *curl, CURLINFO info, struct curl_slist **value)
{
    return curl_easy_getinfo(curl, info, value);
}

static inline CURLMcode curl_multi_setopt_long(CURLM *multi, CURLMoption option, long value)
{
    return curl_multi_setopt(multi, option, value);
}

static inline CURLMcode curl_multi_setopt_pointer(CURLM *multi, CURLMoption option, void *value)
{
    return curl_multi_setopt(multi, option, value);
}

static inline CURLSHcode curl_share_setopt_long(CURLSH *share, CURLSHoption option, long value)
{
    return curl_share_setopt(share, option, value);
}

#ifdef __cplusplus
}
#endif

#endif

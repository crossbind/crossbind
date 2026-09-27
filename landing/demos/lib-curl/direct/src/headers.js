// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    CURLUPart,
    CURLUcode,
    curl_url,
    curl_url_cleanup,
    curl_url_dup,
    curl_url_get,
    curl_url_set,
    curl_url_strerror,
} from '@crossbind/port-curl/curl/urlapi.h';
export {
    CURLversion,
    allocPointer,
    curl_easy_escape,
    curl_easy_unescape,
    curl_free,
    curl_getdate,
    curl_version,
    curl_version_info,
    readCString,
    readPointerAt,
} from '@crossbind/port-curl/curl/curl.h';

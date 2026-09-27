#pragma once

#include <string>

#include "../support/url_json.h"

// The URL apps on crossbind.dev/ports/curl/: libcurl's URL API on typed URLs, every part returned as
// JSON so the page can set it beside the browser's own URL parser. Both calls use the flags libcurl
// uses itself, so the parts are the ones a transfer would use.
class UrlLab {
public:
    // {"ok":true,"url","scheme","user","password","options","host","port","connectPort","path",
    // "query","fragment","zoneid"}, null for a part the URL does not have; or {"ok":false,"code","error"}.
    // Parsed as CURLOPT_URL is before a transfer: CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME.
    static std::string parse(const std::string& url) { return curlapp::parse(url, std::string()); }

    // The same for `location` resolved against `url`, parsed the way curl follows a redirect:
    // CURLU_URLENCODE | CURLU_ALLOW_SPACE.
    static std::string follow(const std::string& url, const std::string& location) { return curlapp::parse(url, location); }
};

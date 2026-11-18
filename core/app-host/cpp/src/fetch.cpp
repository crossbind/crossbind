// What an extension asks a server with (<crossbind/extension.h>'s fetch()): the request it takes, its limits, and the
// platform's own client, which answers it.
#include "crossbind/extension.h"
#include "host_core.h"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace crossbind {

namespace app {

std::string declaredTooLarge(std::uint64_t declared) {
    return "crossbind: the answer declares " + std::to_string(declared) + " bytes, over the " + std::to_string(MAX_FETCH_BYTES) + " a fetch takes";
}

std::string passedTheLimit() { return "crossbind: the answer passed the " + std::to_string(MAX_FETCH_BYTES) + " bytes a fetch takes"; }

std::string tookTooLong() { return "crossbind: the answer took over " + std::to_string(FETCH_SECONDS) + " s"; }

std::string redirectedTooOften() { return "crossbind: the server redirected the fetch more than " + std::to_string(MAX_FETCH_REDIRECTS) + " times"; }

}  // namespace app

void fetch(const std::string &method, const std::string &url, const Request::Headers &headers,
    std::function<void(std::optional<std::string> failure, FetchResponse response)> done) {
    if (method != "GET" && method != "HEAD") throw std::invalid_argument("crossbind: fetch() takes GET or HEAD, not " + method);
    const size_t at = url.find("://");
    std::string scheme = url.substr(0, at);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (at == std::string::npos || (scheme != "http" && scheme != "https")) throw std::invalid_argument("crossbind: fetch() takes an http or https URL, not " + url);
    const std::string authority = url.substr(at + 3, url.find_first_of("/?#", at + 3) - at - 3);
    // A user's name and password in the URL are credentials the client would send.
    if (authority.empty() || authority.find('@') != std::string::npos) {
        throw std::invalid_argument("crossbind: fetch() takes a URL with a host and without a user's name or password, not " + url);
    }
    if (std::any_of(url.begin(), url.end(), [](unsigned char c) { return c <= 0x20 || c >= 0x7f; })) {
        throw std::invalid_argument("crossbind: fetch() takes a URL escaped as an http client sends it, without spaces, controls or other than ASCII");
    }
    for (const auto &[name, value] : headers) {
        if (!app::isToken(name) || app::breaksHeaders(value)) throw std::invalid_argument("crossbind: fetch()'s header " + name + " is no header's name and value");
    }
    if (!done) throw std::invalid_argument("crossbind: fetch() takes a function that gets its answer");
    app::fetchOnPlatform(method, url, headers, std::move(done));
}

}  // namespace crossbind

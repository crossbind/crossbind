// The origins extensions serve (<crossbind/extension.h>'s serveOrigin()) beside the app's own: their names, roles and
// handlers, their URLs on each platform, and the navigation rule that keeps the page of each to its own.
#include "app.h"
#include "page_requests.h"

#include <algorithm>
#include <map>
#include <mutex>
#include <stdexcept>

namespace crossbind {

struct Origin::State {
    std::string name;
    std::string url;
    // Which serveOrigin() of the name it is, as a name served again is another origin's state.
    uint64_t generation = 0;

    ~State() { app::endOrigin(name, generation); }
};

namespace app {

namespace {

// An origin served now: its role and handler, and which serveOrigin() of its name made it.
struct Served {
    std::string role;
    std::function<void(Request)> handler;
    uint64_t generation;
};

std::mutex originsMutex;
std::vector<std::string> appOrigins;
std::map<std::string, Served> served;
uint64_t generations = 0;

// A host's label, as DNS has it.
constexpr size_t MAX_LABEL = 63;

// Chromium's web views take http://<name>.localhost, a secure context of its own per name: Android's WebView can change
// no custom scheme's path, and Chromium's file system API takes http and https origins alone, which WebView2 gives a
// custom scheme no setting for. WebKit's take crossbind://<name>.
#if defined(__ANDROID__) || defined(_WIN32)
constexpr const char *SERVED_SCHEME = "http://";
constexpr std::string_view SERVED_SUFFIX = ".localhost";
#else
constexpr const char *SERVED_SCHEME = "crossbind://";
constexpr std::string_view SERVED_SUFFIX = "";
#endif

// The name of an origin, as a page's scripts name it, of a served origin's form, served now or not.
std::string nameInOrigin(const std::string &origin) {
    const std::string scheme = SERVED_SCHEME;
    return origin.rfind(scheme, 0) == 0 ? nameOfHost(origin.substr(scheme.size())) : "";
}

}  // namespace

bool isLabel(const std::string &text) {
    const auto isLetterOrDigit = [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); };
    return !text.empty() && text.size() <= MAX_LABEL && isLetterOrDigit(text.front()) && isLetterOrDigit(text.back())
           && std::all_of(text.begin(), text.end(), [&](char c) { return isLetterOrDigit(c) || c == '-'; });
}

void setAppOrigins(std::vector<std::string> origins) {
    std::lock_guard<std::mutex> lock(originsMutex);
    appOrigins = std::move(origins);
}

bool isAppOrigin(const std::string &origin) {
    std::lock_guard<std::mutex> lock(originsMutex);
    return std::find(appOrigins.begin(), appOrigins.end(), origin) != appOrigins.end();
}

std::string servedOriginOf(const std::string &name) { return SERVED_SCHEME + name + std::string(SERVED_SUFFIX); }

std::string nameOfHost(const std::string &host) {
    if (host.size() <= SERVED_SUFFIX.size() || host.compare(host.size() - SERVED_SUFFIX.size(), SERVED_SUFFIX.size(), SERVED_SUFFIX) != 0) return "";
    const std::string name = host.substr(0, host.size() - SERVED_SUFFIX.size());
    return isLabel(name) && name != "app" ? name : "";
}

bool isAppHost(const std::string &host) {
#if defined(__ANDROID__)
    return host.empty() || host == "appassets.androidplatform.net";
#else
    return host == "app";
#endif
}

std::string servedNameOf(const std::string &origin) {
    const std::string name = nameInOrigin(origin);
    std::lock_guard<std::mutex> lock(originsMutex);
    return served.count(name) > 0 ? name : "";
}

std::optional<ServedOrigin> servedOrigin(const std::string &name) {
    std::lock_guard<std::mutex> lock(originsMutex);
    const auto found = served.find(name);
    if (found == served.end()) return std::nullopt;
    return ServedOrigin{found->second.role, found->second.handler};
}

std::vector<std::string> servedNames() {
    std::lock_guard<std::mutex> lock(originsMutex);
    std::vector<std::string> names;
    for (const auto &[name, origin] : served) names.push_back(name);
    return names;
}

PageOrigin pageOriginOf(const std::string &url) {
    const std::string origin = originOf(url);
    if (isAppOrigin(origin)) return {"app", "app"};
    const std::string name = nameInOrigin(origin);
    std::lock_guard<std::mutex> lock(originsMutex);
    const auto found = served.find(name);
    if (found == served.end()) return {"", ""};
    return {name, found->second.role};
}

NavigationRule navigationRule(const void *webView, const std::string &url) {
    if (url.rfind("about:", 0) == 0) return NavigationRule::load;
    // A blob URL carries the origin of the page that made it.
    if (url.rfind("blob:", 0) == 0) return navigationRule(webView, url.substr(5));
    const std::string origin = originOf(url);
    const bool isApp = isAppOrigin(origin);
    const std::string name = isApp ? "" : servedNameOf(origin);
    if (!isApp && name.empty()) return NavigationRule::ask;
    const std::string page = originOfPage(webView);
    if (page == "app" || (!name.empty() && page == name)) return NavigationRule::load;
    // Such a URL means nothing outside the app, where page-navigation could send it.
    return page.empty() ? NavigationRule::ask : NavigationRule::refuse;
}

void endOrigin(const std::string &name, uint64_t generation) {
    {
        std::lock_guard<std::mutex> lock(originsMutex);
        const auto found = served.find(name);
        if (found == served.end() || found->second.generation != generation) return;
        served.erase(found);
    }
    endCallsOf(name);
    originEnded(name);
}

}  // namespace app

const std::string &Origin::url() const { return state_->url; }

void Origin::end() const { app::endOrigin(state_->name, state_->generation); }

Origin serveOrigin(const std::string &name, const std::string &role, std::function<void(Request)> handler) {
    if (!app::hasStarted()) {
        throw std::logic_error("crossbind: serveOrigin() serves an origin once the app's extensions have all started, which their entries do not wait for");
    }
    if (!app::isLabel(name) || name == "app") {
        throw std::invalid_argument("crossbind: serveOrigin() takes a name of lowercase letters and digits, which dashes may join, 63 at most, and not app: \"" + name + "\" is none");
    }
    if (!app::isLabel(role) || role == "app") {
        throw std::invalid_argument("crossbind: serveOrigin() takes a role of lowercase letters and digits, which dashes may join, 63 at most, and not app: \"" + role + "\" is none");
    }
    if (!handler) throw std::invalid_argument("crossbind: serveOrigin() takes a handler of the origin's requests");
    auto state = std::make_shared<app::StateOf<Origin>>();
    state->name = name;
    state->url = app::servedOriginOf(name) + "/";
    {
        std::lock_guard<std::mutex> lock(app::originsMutex);
        if (app::served.count(name) > 0) throw std::logic_error("crossbind: the origin " + name + " is served already");
        state->generation = ++app::generations;
        app::served.emplace(name, app::Served{role, std::move(handler), state->generation});
    }
    app::originServed(name);
    return app::make<Origin>(std::move(state));
}

}  // namespace crossbind

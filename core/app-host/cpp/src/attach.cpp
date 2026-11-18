#include "app.h"
#include "page_requests.h"

#include <cstdlib>
#include <map>
#include <set>

#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif

namespace crossbind::app {

namespace {

constexpr const char *APP_ORIGIN = "crossbind://app";
constexpr const char *APP_URL = "crossbind://app/";
constexpr const char *REFUSED = "[1,{\"name\":\"Error\",\"message\":\"crossbind: a page from this origin may not call the app's module\"}]";

// The platform and arch the host is built for, as crossbind/app's device names them.
#if defined(_WIN32)
constexpr const char *PLATFORM = "windows";
#elif defined(__APPLE__) && TARGET_OS_IPHONE
constexpr const char *PLATFORM = "ios";
#elif defined(__APPLE__)
constexpr const char *PLATFORM = "macos";
#else
constexpr const char *PLATFORM = "linux";
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
constexpr const char *ARCH = "arm64";
#else
constexpr const char *ARCH = "x64";
#endif

// Where the app runs, frozen, which crossbind/app's device reads from the page's start.
std::string deviceScript() {
    const System system = appSystem();
    const Value device = Value::Object{
        {"platform", PLATFORM},
        {"arch", ARCH},
        {"formFactor", system.formFactor},
        {"os", Value::Object{{"name", system.osName}, {"version", system.osVersion}}},
        {"isVirtual", system.isVirtual},
    };
    return "Object.defineProperty(globalThis, '__crossbind_device', { value: ((device) => (Object.freeze(device.os), Object.freeze(device)))(" +
           device.json() + ") });";
}

// The core whose windows attach() readied, and the page each shows first; on the main thread.
Core *attached = nullptr;
std::string firstUrl;
// The served origins whose script each window's top frames run, by the window's id; on the main thread.
std::map<uint64_t, std::set<std::string>> scripted;

// A served origin's script, once in each window: it gives the top frame of a page of the origin the origin's token for
// the window, where the app runs, and the base of its calls, its own origin's, which needs no other origin's leave.
// Whether an origin is of the form a served one has, served now or not.
bool isServedForm(const std::string &origin) {
    const auto scheme = origin.find("://");
    const std::string name = scheme == std::string::npos ? "" : nameOfHost(origin.substr(scheme + 3));
    return !name.empty() && servedOriginOf(name) == origin;
}

void addOriginScript(void *webView, uint64_t window, const std::string &name) {
    if (!scripted[window].insert(name).second) return;
    const std::string origin = servedOriginOf(name);
    addTopFrameScript(webView, "if (location.protocol + '//' + location.host === '" + origin + "') { Object.defineProperty(globalThis, '__crossbind_token', { value: '" +
                                   attached->tokenOf(window, name) + "' }); Object.defineProperty(globalThis, '__crossbind_calls', { value: '" + origin +
                                   "/__crossbind/b' }); " + deviceScript() + " }");
}

}  // namespace

std::string attach(Core &core, void *webView, const char *devUrl, uint64_t window) {
    attached = &core;
    std::vector<std::string> origins{APP_ORIGIN};
    if (devUrl) origins.push_back(originOf(devUrl));
    setAppOrigins(origins);
    firstUrl = devUrl ? devUrl : APP_URL;
    // Only the top frame of the app's own origins gets the token of the window's channel, which every message and
    // crossbind:// call carries, and where the app runs: a frame of another origin, or a sandboxed one, cannot read
    // them, and a page of another origin page-navigation loads gets neither. A served origin's top frame gets a token of
    // its own.
    std::string own;
    for (const auto &origin : origins) own += (own.empty() ? "'" : ",'") + origin + "'";
    addTopFrameScript(webView, "if ([" + own + "].includes(location.protocol + '//' + location.host)) { Object.defineProperty(globalThis, '__crossbind_token', { value: '" +
                                   core.addWindow(window) + "' }); " + deviceScript() + " }");
    for (const auto &name : servedNames()) addOriginScript(webView, window, name);
    installReplyChannel(webView, "crossbind", [&core](std::string origin, std::string message, ReplyFn reply) {
        // A page of a served origin that ended still sends its token, which the core refuses, saying it ended.
        if (!origin.empty() && !isOwnOrigin(origin) && !isServedForm(origin)) {
            reply(REFUSED);
            return;
        }
        core.receive(std::move(origin), std::move(message), std::move(reply));
    });
    if (devUrl || std::getenv("CROSSBIND_APP_CONSOLE")) forwardConsole(webView);
    showPageDialogs(webView);
    answerPermissions(webView);
    restrictNavigation(webView, [&core, window](const std::string &url) { core.reset(window, url); });
    takeDownloads(webView);
    takeDrops(webView);
    return firstUrl;
}

void originServed(const std::string &name) {
    onMainThread([name] {
        if (!attached) return;
        for (const Window &window : openWindows()) addOriginScript(window.webView(), window.id(), name);
    });
}

void originEnded(const std::string &name) {
    onMainThread([name] {
        for (const void *webView : webViewsShowing(name)) loadOwnPage(const_cast<void *>(webView), firstUrl);
    });
}

}  // namespace crossbind::app

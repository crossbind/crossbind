#include "app.h"
#include "page_requests.h"

#include <algorithm>
#include <cstdlib>

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

}  // namespace

std::string attach(Core &core, void *webView, const char *devUrl, uint64_t window) {
    std::vector<std::string> origins{APP_ORIGIN};
    if (devUrl) origins.push_back(originOf(devUrl));
    setOwnOrigins(origins);
    // Only the top frame of the app's own origins gets the token of the window's channel, which every message and
    // crossbind:// call carries, and where the app runs: a frame of another origin, or a sandboxed one, cannot read
    // them, and a page of another origin page-navigation loads gets neither.
    std::string own;
    for (const auto &origin : origins) own += (own.empty() ? "'" : ",'") + origin + "'";
    addTopFrameScript(webView, "if ([" + own + "].includes(location.protocol + '//' + location.host)) { Object.defineProperty(globalThis, '__crossbind_token', { value: '" +
                                   core.addWindow(window) + "' }); " + deviceScript() + " }");
    installReplyChannel(webView, "crossbind", [&core, origins](std::string origin, std::string message, ReplyFn reply) {
        if (!origin.empty() && std::find(origins.begin(), origins.end(), origin) == origins.end()) {
            reply(REFUSED);
            return;
        }
        core.receive(std::move(message), std::move(reply));
    });
    if (devUrl || std::getenv("CROSSBIND_APP_CONSOLE")) forwardConsole(webView);
    showPageDialogs(webView);
    // The app's own origins load without asking, and page-navigation decides every other URL.
    answerPermissions(webView);
    restrictNavigation(webView, origins, [&core, window] { core.reset(window); });
    takeDownloads(webView);
    takeDrops(webView, origins);
    return devUrl ? devUrl : APP_URL;
}

}  // namespace crossbind::app

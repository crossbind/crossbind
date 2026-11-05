#include "app.h"
#include "page_requests.h"

#include <algorithm>
#include <cstdlib>

namespace crossbind::app {

namespace {

constexpr const char *APP_ORIGIN = "crossbind://app";
constexpr const char *APP_URL = "crossbind://app/";
constexpr const char *REFUSED = "[1,{\"name\":\"Error\",\"message\":\"crossbind: a page from this origin may not call the app's module\"}]";

}  // namespace

std::string attach(Core &core, void *webView, const char *devUrl) {
    std::vector<std::string> origins{APP_ORIGIN};
    if (devUrl) origins.push_back(originOf(devUrl));
    setOwnOrigins(origins);
    // Only the top frame of the app's own origins gets the token every message and crossbind:// call carries: a frame
    // of another origin, or a sandboxed one, cannot read it, and a page of another origin page-navigation loads gets
    // none.
    std::string own;
    for (const auto &origin : origins) own += (own.empty() ? "'" : ",'") + origin + "'";
    addTopFrameScript(webView, "if ([" + own + "].includes(location.protocol + '//' + location.host)) Object.defineProperty(globalThis, '__crossbind_token', { value: '" +
                                   core.token() + "' });");
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
    restrictNavigation(webView, origins, [&core] { core.reset(); });
    takeDownloads(webView);
    takeDrops(webView, origins);
    return devUrl ? devUrl : APP_URL;
}

}  // namespace crossbind::app

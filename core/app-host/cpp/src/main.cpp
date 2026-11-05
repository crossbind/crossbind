// A desktop app: windows with the system webview whose pages reach a crossbind module running in Hermes. The pages come
// from crossbind://app/, or in the debug host the dev server opens, from the URL CROSSBIND_APP_URL names. Their calls
// arrive as webview messages, their large bytes as crossbind:// request and response bodies.
#include "desktop.h"
#include "platform.h"
#include "webview/webview.h"

namespace {

namespace app = crossbind::app;

#ifdef _WIN32
// Windows 11 comes with the runtime; Windows 10 has it from Edge's updates, if at all.
constexpr const char *WEBVIEW2_MISSING = "the app needs the Microsoft Edge WebView2 Runtime, which this computer lacks: "
                                         "install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and open the app again";
#endif

}  // namespace

int main(int argc, char **argv) {
    const char *devUrl = app::devUrl();
    const crossbind::Launch launch = app::launchOf(argc, argv);
    app::Core &core = app::start(devUrl, &launch);
    // The links and files this launch was given reach their owners: an extension's at once, the page's once it asks for
    // them.
    app::openLaunch(launch);
#ifdef __APPLE__
    // macOS hands the app its links as it finishes launching, which the loop starts, and the notification that launched
    // it after.
    listenForUrls();
    ownNotificationCenter();
#endif
    app::startTakingLaunches();
    try {
        app::openFirstWindow(core, devUrl);
        // Quitting from the Dock or the system ends the app as closing its last window does.
        onQuit([&core] { app::quit(core, 0); });
        runLoop();
        app::quit(core, 0);
    } catch (const webview::exception &error) {
#ifdef _WIN32
        if (error.error().code() == WEBVIEW_ERROR_MISSING_DEPENDENCY) app::fail(core, devUrl, WEBVIEW2_MISSING);
#endif
        // Some of webview's errors come with a code alone.
        const std::string detail = *error.what() ? error.what() : "webview error " + std::to_string(error.error().code());
        app::fail(core, devUrl, "the app's window cannot open: " + detail);
    } catch (const std::exception &error) {
        app::fail(core, devUrl, std::string("the app's window cannot open: ") + error.what());
    }
}

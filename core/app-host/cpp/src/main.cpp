// A desktop app: a window with the system webview whose page reaches a crossbind module running in Hermes. The page
// comes from crossbind://app/, or in the debug host the dev server opens, from the URL CROSSBIND_APP_URL names. Its
// calls arrive as webview messages, their large bytes as crossbind:// request and response bodies.
#include "app.h"
// The app's name and window, which crossbind writes into the build directory from crossbind.config.js.
#include "crossbind_app.h"
#include "platform.h"
#include "webview/webview.h"

namespace {

namespace app = crossbind::app;

SchemeHandler schemeHandler;

#ifdef __APPLE__
// WKWebView takes its scheme handlers, and how it runs a hidden page, from the configuration it is made from.
void configureWebView(void *configuration) {
    registerSchemeHandler(configuration, "crossbind", schemeHandler);
    keepRunningWhenHidden(configuration);
}
#elif defined(_WIN32)
// WebView2 takes its schemes from the environment the webview is made in; a dev server's page requests the scheme too.
// webview asks again on every attempt to make the environment, which keeps what it needs of them.
std::vector<std::string> schemeOrigins;
ICoreWebView2EnvironmentOptions *environmentOptions() {
    static auto *options = static_cast<ICoreWebView2EnvironmentOptions *>(schemeEnvironmentOptions("crossbind", schemeOrigins));
    return options;
}

// Windows 11 comes with the runtime; Windows 10 has it from Edge's updates, if at all.
constexpr const char *WEBVIEW2_MISSING = "the app needs the Microsoft Edge WebView2 Runtime, which this computer lacks: "
                                         "install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and open the app again";
#endif

}  // namespace

int main(int argc, char **argv) {
    const char *devUrl = app::devUrl();
    const crossbind::Launch launch = app::launchOf(argc, argv);
    app::Core &core = app::start(devUrl, &launch);
    schemeHandler = [&core](SchemeRequest request, SchemeRespond respond) { core.serve(std::move(request), std::move(respond)); };
    // The links and files this launch was given reach their owners: an extension's at once, the page's once it asks for
    // them.
    app::openLaunch(launch);
#ifdef __APPLE__
    // macOS hands the app its links as it finishes launching, which the window starts, and the notification that
    // launched it after.
    listenForUrls();
    ownNotificationCenter();
#endif
    app::startTakingLaunches();

#ifdef __APPLE__
    webview::detail::cocoa_webkit::cocoa_configure_hook = configureWebView;
#elif defined(_WIN32)
    if (devUrl) schemeOrigins.push_back(app::originOf(devUrl));
    webview::detail::win32_environment_options_hook = environmentOptions;
    webview::detail::win32_user_data_folder_hook = webViewProfile;
#endif
    try {
        webview::webview view(devUrl != nullptr, nullptr);
#ifdef CROSSBIND_APP_BACKGROUND_COLOR
        setBackgroundColor(view.window().value(), view.browser_controller().value(), CROSSBIND_APP_BACKGROUND_COLOR);
#endif
        view.set_title(CROSSBIND_APP_NAME);
        // The sizes are the page's, whatever frame the window adds around it.
        view.set_size(CROSSBIND_APP_WINDOW_WIDTH, CROSSBIND_APP_WINDOW_HEIGHT,
                      CROSSBIND_APP_WINDOW_RESIZABLE ? WEBVIEW_HINT_NONE : WEBVIEW_HINT_FIXED);
        if (CROSSBIND_APP_WINDOW_MIN_WIDTH || CROSSBIND_APP_WINDOW_MIN_HEIGHT) {
            view.set_size(CROSSBIND_APP_WINDOW_MIN_WIDTH, CROSSBIND_APP_WINDOW_MIN_HEIGHT, WEBVIEW_HINT_MIN);
        }
#ifdef CROSSBIND_APP_WINDOW_MAX_WIDTH
        view.set_size(CROSSBIND_APP_WINDOW_MAX_WIDTH, CROSSBIND_APP_WINDOW_MAX_HEIGHT, WEBVIEW_HINT_MAX);
#endif
#ifdef __APPLE__
        installAppMenu();
#endif
        void *webView = view.browser_controller().value();
        setMainWindow(view.window().value(), webView);
#ifndef __APPLE__
        registerSchemeHandler(webView, "crossbind", schemeHandler);
#endif
#ifdef _WIN32
        followPageFullScreen(webView);
#endif
#ifdef CROSSBIND_APP_WINDOW_FULLSCREEN
        fillScreen();
#endif
        const std::string url = app::attach(core, webView, devUrl);
        // Quitting from the Dock or the system ends the app as closing its window does.
        onQuit([&core] { app::quit(core, 0); });
        app::windowOpened(view.window().value(), webView);

        view.navigate(url);
        view.run();
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

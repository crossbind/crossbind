// A desktop app's windows, by their ids: what crossbind/app's windows.* reach, the first one of app.window's options,
// and each closing, its own children first, as the app quits once the last has closed.
#include "desktop.h"

// The app's name and window, which crossbind writes into the build directory from crossbind.config.js.
#include "crossbind_app.h"
#include "webview/webview.h"

#include <map>
#include <stdexcept>

namespace crossbind::app {

namespace {

#ifdef _WIN32
// webview sizes a window it made at 640×480, and shows it, once its loop runs, and again for each script it adds until
// it has shown the window itself: the host sizes and shows each window as it opens it.
class View : public webview::webview {
  public:
    View(bool debug, void *window) : webview::webview(debug, window) {}

  protected:
    webview::noresult set_size_impl(int, int, webview_hint_t) override { return {}; }
};
#else
using View = webview::webview;
#endif

struct DesktopWindow {
    std::unique_ptr<webview::webview> view;
    void *native;
    void *webView;
    uint64_t parent;
    bool isModal;
};

// The open windows, on the main thread.
std::map<uint64_t, DesktopWindow> open;
Core *running = nullptr;
const char *devServer = nullptr;
SchemeHandler schemeHandler;

#ifdef __APPLE__
// WKWebView takes its scheme handlers, and how it runs a hidden page, from the configuration it is made from.
void configureWebView(void *configuration) {
    registerSchemeHandler(configuration, "crossbind", schemeHandler);
    keepRunningWhenHidden(configuration);
}
#elif defined(_WIN32)
// WebView2 takes its schemes from the environment the webview is made in; a dev server's page requests the scheme too.
// webview asks again on every attempt to make the environment, which keeps what it needs of them, and every window's
// webview gets the same.
std::vector<std::string> schemeOrigins;
ICoreWebView2EnvironmentOptions *environmentOptions() {
    static auto *options = static_cast<ICoreWebView2EnvironmentOptions *>(schemeEnvironmentOptions("crossbind", schemeOrigins));
    return options;
}
#endif

DesktopWindow &windowAt(uint64_t id) {
    const auto at = open.find(id);
    if (at == open.end()) throw std::invalid_argument("crossbind: no window " + std::to_string(id) + " of the app's is open");
    return at->second;
}

// The URL of one of the app's pages: the first window's own, and another path at the same origin.
std::string urlOf(const std::string &first, const std::string &path) { return path == "/" ? first : originOf(first) + path; }

// Closes a window the host let close, its own children first: the extensions hear of it while it is there, then it goes.
// The app quits as its last window closes.
void closeNow(uint64_t id) {
    if (open.count(id) == 0) return;
    std::vector<uint64_t> children;
    for (const auto &[child, window] : open) {
        if (window.parent == id) children.push_back(child);
    }
    for (const uint64_t child : children) closeNow(child);
    windowClosed(id);
    DesktopWindow closing = std::move(open.at(id));
    open.erase(id);
    const auto parent = open.find(closing.parent);
    destroyWindow(closing.native, parent == open.end() ? nullptr : parent->second.native, closing.isModal, [&closing] { closing.view.reset(); });
    if (open.empty()) endLoop();
}

WindowOptions firstWindowOptions() {
    WindowOptions options;
    options.title = CROSSBIND_APP_NAME;
    options.width = CROSSBIND_APP_WINDOW_WIDTH;
    options.height = CROSSBIND_APP_WINDOW_HEIGHT;
    options.minWidth = CROSSBIND_APP_WINDOW_MIN_WIDTH;
    options.minHeight = CROSSBIND_APP_WINDOW_MIN_HEIGHT;
#ifdef CROSSBIND_APP_WINDOW_MAX_WIDTH
    options.maxWidth = CROSSBIND_APP_WINDOW_MAX_WIDTH;
    options.maxHeight = CROSSBIND_APP_WINDOW_MAX_HEIGHT;
#endif
    options.resizable = CROSSBIND_APP_WINDOW_RESIZABLE;
#ifdef CROSSBIND_APP_WINDOW_FULLSCREEN
    options.fullscreen = true;
#endif
    return options;
}

// What every window shows until its page paints, and behind it, unless windows.open() gave it a color of its own.
std::optional<std::uint32_t> appBackgroundColor() {
#ifdef CROSSBIND_APP_BACKGROUND_COLOR
    return CROSSBIND_APP_BACKGROUND_COLOR;
#else
    return std::nullopt;
#endif
}

}  // namespace

void openFirstWindow(Core &core, const char *devUrl) {
    running = &core;
    devServer = devUrl;
    schemeHandler = [&core](SchemeRequest request, SchemeRespond respond) { core.serve(std::move(request), std::move(respond)); };
#ifdef __APPLE__
    webview::detail::cocoa_webkit::cocoa_configure_hook = configureWebView;
#elif defined(_WIN32)
    if (devUrl) schemeOrigins.push_back(originOf(devUrl));
    webview::detail::win32_environment_options_hook = environmentOptions;
    webview::detail::win32_user_data_folder_hook = webViewProfile;
#endif
    startWindows();
    openAppWindow(firstWindowOptions(), [](std::optional<std::string>, uint64_t, std::vector<std::string>) {});
}

bool closeAsked(uint64_t id) {
    if (open.count(id) == 0 || !isCloseAllowed(id)) return false;
    onMainThread([id] { closeNow(id); });
    return true;
}

void openAppWindow(const WindowOptions &options, WindowOpened done) {
    // A name of an open window brings that window to the front.
    if (!options.name.empty()) {
        for (const auto &[id, window] : open) {
            if (nameOfWindow(id) == options.name) {
                focusWindow(window.native);
                done(std::nullopt, id, {});
                return;
            }
        }
    }
    std::vector<std::string> ignored;
    void *parent = options.parent ? windowAt(options.parent).native : nullptr;
    std::unique_ptr<webview::webview> view = std::make_unique<View>(devServer != nullptr, makeWindow(options, parent, ignored));
    void *native = view->window().value();
    void *webView = view->browser_controller().value();
    if (const std::optional<std::uint32_t> color = options.backgroundColor ? options.backgroundColor : appBackgroundColor()) {
        setBackgroundColor(native, webView, *color);
    }
#ifndef __APPLE__
    registerSchemeHandler(webView, "crossbind", schemeHandler);
#endif
#ifdef _WIN32
    followPageFullScreen(webView);
#endif
    const uint64_t id = windowOpened(native, webView, options.name);
    readyWindow(native, webView, id, options, parent, ignored);
    DesktopWindow &opened = open.emplace(id, DesktopWindow{std::move(view), native, webView, options.parent, options.modal}).first->second;
    const std::string url = attach(*running, webView, devServer, id);
    opened.view->navigate(urlOf(url, options.path));
    presentWindow(native, webView, options, parent);
    done(std::nullopt, id, std::move(ignored));
}

void changeAppWindow(uint64_t id, const WindowChanges &changes, std::vector<std::string> &ignored) {
    const DesktopWindow &window = windowAt(id);
    changeWindow(window.native, window.webView, changes, ignored);
}

void closeAppWindow(uint64_t id) {
    windowAt(id);
    if (isCloseAllowed(id)) closeNow(id);
}

void focusAppWindow(uint64_t id) { focusWindow(windowAt(id).native); }

void minimizeAppWindow(uint64_t id) { minimizeWindow(windowAt(id).native); }

void toggleMaximizeAppWindow(uint64_t id) { toggleMaximizeWindow(windowAt(id).native); }

void dragAppWindow(uint64_t id) { dragWindow(windowAt(id).native); }

WindowState appWindowState(uint64_t id) {
    const DesktopWindow &window = windowAt(id);
    return stateOfWindow(window.native, window.webView);
}

}  // namespace crossbind::app

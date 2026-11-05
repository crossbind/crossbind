#pragma once

// What a platform gives the host: the webview's channels, its URL scheme, its navigation rule and where the app's
// files are. darwin/ implements it with WKWebView on macOS and iOS (ios/ has the iOS app's own parts), linux/ with
// WebKitGTK, windows/ with WebView2.
#include "crossbind/app.h"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using ReplyFn = std::function<void(const std::string &)>;
// A page message with the origin of the frame that sent it, empty where the webview does not tell it (WebKitGTK).
// reply() may be called from any thread.
using MessageHandler = std::function<void(std::string origin, std::string message, ReplyFn reply)>;

struct SchemeRequest {
    std::string method;
    std::string path;
    std::string query;
    std::vector<uint8_t> body;
};

struct SchemeResponse {
    int status = 200;
    std::string mime = "application/octet-stream";
    std::vector<uint8_t> body;
    std::vector<std::pair<std::string, std::string>> headers;
};

using SchemeRespond = std::function<void(SchemeResponse)>;
using SchemeHandler = std::function<void(SchemeRequest, SchemeRespond)>;

// A message channel whose reply resolves the page's own postMessage() promise.
void installReplyChannel(void *webView, const char *name, MessageHandler handler);
// The page's console and uncaught errors, written to this process's output.
void forwardConsole(void *webView);
// Runs a script in the top frame of every page, before the page's own.
void addTopFrameScript(void *webView, const std::string &source);
// Serves <scheme>:// requests: on macOS of the webview made from this configuration, on Linux of this web view.
// respond() may be called from any thread.
void registerSchemeHandler(void *target, const char *scheme, SchemeHandler handler);
// The webview loads only these origins, in any frame; a link to another opens in the default browser. newPage runs
// when the main frame commits another document.
void restrictNavigation(void *webView, std::vector<std::string> origins, std::function<void()> newPage);
// Runs when the app is quit other than by closing its window (the Dock on macOS, the system on iOS), before it would
// exit.
void onQuit(std::function<void()> quit);
// The page's alert(), confirm() and prompt(), and its file inputs where the webview lets the host take them, go to the
// extensions page-dialogs and page-files; without one, the webview shows its own.
void showPageDialogs(void *webView);
// What the page asks to use goes to the extension page-permissions; without it, the webview does as it would. A macOS
// page's location comes from the extension page-location, which asks page-permissions as well.
void answerPermissions(void *webView);
// Tells the user why the app cannot go on: in a message box on the desktop, in the system's log on iOS and Android.
void showError(const std::string &message);
// Where the app's files are.
std::string resourceDir();

// The app's functions behind crossbind/app and <crossbind/app.h>, and what the app's window does; a platform that has no
// such function throws.
using Failure = std::optional<std::string>;
// Whether the caller is the app's main thread, where the platform's UI runs.
bool isMainThread();
namespace crossbind::app {
// Whether the window closes as its user closes it: true unless an extension's onClose keeps it. On the main thread.
bool isCloseAllowed();
}  // namespace crossbind::app
// Runs a task of the main thread's, whose loop never sees what it throws: the failure is told, and a call the task held
// fails as the task lets go of it.
void runTask(const std::function<void()> &task);
// The app's folders, made if missing; on any thread.
crossbind::app::Paths appPaths();
// Ends the app on the main thread, as closing its window does.
void quitApp();
// Opens the app anew, with no arguments: on macOS and Linux once this process has ended, on Windows as it ends, where an
// app that app.singleInstance keeps to one instance waits for this one to end. Why not when it cannot.
Failure openAnew();
// The app's window and its webview, which appWindow() and appWebView() give its extensions.
void setMainWindow(void *window, void *webView);
// Brings a desktop app's window to the front, restored if it was minimized; token is what lets a Linux window take the
// front from another app. On any thread.
void showWindow(const std::string &token);
// A desktop app's window and webview show this color, 0xRRGGBB, until the page paints and behind a page without a
// background of its own. On the main thread, before the window shows.
void setBackgroundColor(void *window, void *webView, std::uint32_t color);
// The window fills the screen, as app.window.fullscreen asks. On the main thread.
void fillScreen();

#ifdef __APPLE__
// macOS sends the standard shortcuts, ⌘C and ⌘Q among them, through the menu bar, so a window without the app, Edit,
// View and Window menus never sees them.
void installAppMenu();
// Hears of the links of the app's schemes macOS opens it with, the launch's own as well, which come as Apple Events.
void listenForUrls();
// The page of the webview made from this configuration keeps running while its window is hidden.
void keepRunningWhenHidden(void *configuration);
// Shows an iOS view controller, such as an alert, over whatever the window shows on top; false when it has nothing to
// show it over.
bool presentOnTop(void *controller, void *window);
#endif

#ifdef _WIN32
// The ICoreWebView2EnvironmentOptions WebView2's environment is made with: they register the scheme, which pages of
// these other origins may request as well.
void *schemeEnvironmentOptions(const char *scheme, const std::vector<std::string> &origins);
// The window fills the screen while the page shows an element full screen, which WebView2 leaves to its host. On the
// main thread.
void followPageFullScreen(void *controller);
// A window that fills its screen fills it again once Windows changes the screen's size or scale. On the main thread.
void fitFullScreen();
// The folder WebView2 keeps the page's profile in: the app's own, on this machine.
std::wstring webViewProfile();
#endif

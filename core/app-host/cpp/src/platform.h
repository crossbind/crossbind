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
    // As the URL has it, its escapes kept.
    std::string path;
    std::string query;
    std::vector<uint8_t> body;
    std::vector<std::pair<std::string, std::string>> headers;
    // The webview that asks, as windowOpened() was given it; null on Android, whose page is of no window.
    const void *webView = nullptr;
};

struct SchemeResponse {
    int status = 200;
    std::string mime = "application/octet-stream";
    std::vector<uint8_t> body;
    std::vector<std::pair<std::string, std::string>> headers;
    // A file, by its path in UTF-8, whose fileLength bytes are the body in body's place, which the platform reads as the
    // webview takes it.
    std::string file;
    std::uint64_t fileLength = 0;
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
// These origins load in any frame without asking; the extension page-navigation decides every other URL, the page's
// own windows, and the HTTP authentication and certificate errors of its requests. newPage runs when the main frame
// commits another document.
void restrictNavigation(void *webView, std::vector<std::string> origins, std::function<void()> newPage);
// The page's downloads go to the extension page-downloads, before any of each arrives.
void takeDownloads(void *webView);
// The files the app's user drops on a page of these origins go to the extension page-drops, on the desktop, as the
// page's own drop goes on.
void takeDrops(void *webView, std::vector<std::string> origins);
// Runs when the app is quit other than by closing its window (the Dock on macOS, the system on iOS, the end of the
// session on Windows), before it would exit.
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
// Whether the window of this id closes as its user closes it: true unless an extension's onClose keeps it. On the main
// thread.
bool isCloseAllowed(uint64_t window);
// Runs the extensions' onWindowClosed for each window still open, on the main thread, as the app's windows close, while
// they are there: before Linux and Windows destroy theirs, and as the app quits.
void windowsClosed();
// Whether the app quits as its user or its system asks it to: true unless an extension's onQuitRequest keeps it
// running. On the main thread.
bool isQuitAllowed();
// Tells the extensions and the page that the app became active or inactive, once for each change. On the main thread.
void appActivated(bool isActive);
// Runs the extensions' onReopen, on the main thread, once the window shows again.
void reopened();
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
// Brings the desktop app's window in front to the front, restored if it was minimized; token is what lets a Linux window
// take the front from another app. On any thread.
void showWindow(const std::string &token);
// A desktop app's window and webview show this color, 0xRRGGBB, until the page paints and behind a page without a
// background of its own. On the main thread, before the window shows.
void setBackgroundColor(void *window, void *webView, std::uint32_t color);

namespace crossbind::app {
// What a window of the app's opens with: the options of crossbind/app's windows.open(), or app.window's for an app's
// first. Sizes are the page's, in logical pixels, 0 for no limit; x and y place the window's frame from the top left of
// the main screen, and without them the window opens in its middle.
struct WindowOptions {
    std::string path = "/";
    std::string title;
    std::string name;
    int width = 1024;
    int height = 768;
    int minWidth = 0;
    int minHeight = 0;
    int maxWidth = 0;
    int maxHeight = 0;
    bool resizable = true;
    bool fullscreen = false;
    std::optional<std::uint32_t> backgroundColor;
    std::optional<int> x;
    std::optional<int> y;
    bool alwaysOnTop = false;
    bool frame = true;
    uint64_t parent = 0;
    bool modal = false;
};
// What windows.set() changes of an open window: each key it was given.
struct WindowChanges {
    std::optional<std::string> title;
    std::optional<int> width;
    std::optional<int> height;
    std::optional<int> x;
    std::optional<int> y;
    bool center = false;
    std::optional<int> minWidth;
    std::optional<int> minHeight;
    std::optional<int> maxWidth;
    std::optional<int> maxHeight;
    std::optional<bool> resizable;
    std::optional<bool> alwaysOnTop;
    std::optional<bool> fullscreen;
};
// An open window as windows.list() tells of it: its frame's place and its page's size, in logical pixels.
struct WindowState {
    std::string title;
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    bool isMaximized = false;
    bool isMinimized = false;
    bool isFullscreen = false;
    bool isFocused = false;
};

// The windows of crossbind/app's windows.*, on the main thread. A window opens with these options and loads its page,
// and done gets on the main thread why it did not, or its id, with the keys the platform could not honour: at once on
// the desktop, and as its scene connects on an iPad. Each other call names an open window; one that names none throws,
// as an Android app does for every one.
using WindowOpened = std::function<void(std::optional<std::string> failure, uint64_t id, std::vector<std::string> ignored)>;
void openAppWindow(const WindowOptions &options, WindowOpened done);
void changeAppWindow(uint64_t id, const WindowChanges &changes, std::vector<std::string> &ignored);
// Closes it as its user does: an extension's onClose may keep it, but for an iPad's scene, which iOS closes.
void closeAppWindow(uint64_t id);
// Brings it to the front, restored if it was minimized.
void focusAppWindow(uint64_t id);
void minimizeAppWindow(uint64_t id);
void toggleMaximizeAppWindow(uint64_t id);
// Moves it with the pointer while the primary button is down, as its title bar does.
void dragAppWindow(uint64_t id);
WindowState appWindowState(uint64_t id);
}  // namespace crossbind::app

#ifdef __APPLE__
// macOS sends the standard shortcuts, ⌘C and ⌘Q among them, through the menu bar, so a window without the app, Edit,
// View and Window menus never sees them.
void installAppMenu();
// Tells the extensions and the pages as a macOS app becomes active and leaves it, and answers AppKit's Quit and Dock
// click: the app's delegate is set.
void watchApp();
// Shows the windows of a macOS app that were hidden or minimized, as a click of its Dock icon does.
void showHiddenWindows();
// Tells the extensions and the page as an iOS app comes to the foreground and leaves it, once for all its scenes.
void listenForActivity();
// Hears of the links of the app's schemes and the files macOS opens it with, the launch's own as well, which come as
// Apple Events, and of what the app's delegate is handed from the launch on, through answerLaunches().
void listenForUrls();
// Has the app's delegate, webview's, hand the extensions the user activities and push macOS gives it, as it finishes
// launching, before the launch's own come.
void answerLaunches();
// Asks a macOS app to quit as its user's Quit does, through AppKit, whose question of the app's delegate asks its
// extensions. On any thread.
void terminateApp();
// The page of the webview made from this configuration keeps running while its window is hidden.
void keepRunningWhenHidden(void *configuration);
// A window the page asked for with window.open(), which the UI delegate hands on with its WKNavigationAction: the app
// opens no window of the page's, so it loads in the page's place, opens outside or loads nothing, as page-navigation
// decides.
void openPageWindow(void *webView, void *navigationAction);
// Shows an iOS view controller, such as an alert, over whatever the window shows on top; false when it has nothing to
// show it over.
bool presentOnTop(void *controller, void *window);
// A user activity, an NSUserActivity, the system continues the app with, on the main thread: a web page's is a site's
// link, which reaches its owner as a link does, and one of another type the owner of its type. Whether one took it.
bool continueActivity(void *activity);
// The host takes the system's notification center, whose notifications reach the extensions' onNotification, before
// the app finishes launching, as the tap that launched it comes after; an app outside a bundle has none.
void ownNotificationCenter();
#endif

#ifdef _WIN32
// The ICoreWebView2EnvironmentOptions WebView2's environment is made with: they register the scheme, which pages of
// these other origins may request as well.
void *schemeEnvironmentOptions(const char *scheme, const std::vector<std::string> &origins);
// The window of this controller fills the screen while the page shows an element full screen, which WebView2 leaves to
// its host. On the main thread.
void followPageFullScreen(void *controller);
// The folder WebView2 keeps the page's profile in: the app's own, on this machine.
std::wstring webViewProfile();
#endif

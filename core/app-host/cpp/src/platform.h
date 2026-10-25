#pragma once

// What a platform gives the host: the webview's channels, its URL scheme, its navigation rule and where the app's
// files are. darwin/ implements it with WKWebView on macOS and iOS (ios/ has the iOS app's own parts), linux/ with
// WebKitGTK, windows/ with WebView2.
#include "crossbind/app.h"

#include <cstdint>
#include <filesystem>
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
// The page's alert(), confirm() and prompt(), and on macOS its file inputs, as a browser shows them. WebKitGTK and
// WebView2 show them themselves.
void showPageDialogs(void *webView);
// The page gets the camera, microphone and location app.permissions lists, once the system's user gives them where the
// system asks, and is denied them otherwise; the webview asks nothing of its own.
void answerPermissions(void *webView);
// Tells the user why the app cannot go on: in a message box on the desktop, in the system's log on iOS and Android.
void showError(const std::string &message);
// Where the app's files are.
std::string resourceDir();

// The app's functions behind crossbind/app and <crossbind/app.h>. Each is called on the module's thread, works on the
// main thread and calls done there: a file dialog with what its user picked, or nothing when they cancelled; a message
// dialog with the index of the button clicked, or NO_BUTTON when its user closed it without one; the others with why
// they failed, or nothing. A platform that has no such function throws.
using Picked = std::optional<std::vector<std::string>>;
using Failure = std::optional<std::string>;
constexpr int NO_BUTTON = -1;
void showOpenDialog(crossbind::app::OpenOptions options, std::function<void(Picked)> done);
void showSaveDialog(crossbind::app::SaveOptions options, std::function<void(std::optional<std::string>)> done);
void showMessageDialog(crossbind::app::MessageOptions options, std::function<void(int)> done);
// An http, https or mailto address, which the caller has checked.
void openUrl(std::string url, std::function<void(Failure)> done);
void openFile(std::string path, std::function<void(Failure)> done);
void revealFile(std::string path, std::function<void(Failure)> done);
// The app's folders, made if missing; on any thread.
crossbind::app::Paths appPaths();
// Ends the app on the main thread, as closing its window does.
void quitApp();
// The window the app's dialogs belong to.
void setMainWindow(void *window);
// Brings a desktop app's window to the front, restored if it was minimized; token is what lets a Linux window take the
// front from another app. On any thread.
void showWindow(const std::string &token);
// A desktop app's window and webview show this color, 0xRRGGBB, until the page paints and behind a page without a
// background of its own. On the main thread, before the window shows.
void setBackgroundColor(void *window, void *webView, std::uint32_t color);
// The window fills the screen, as app.window.fullscreen asks. On the main thread.
void fillScreen();
// Fetches an address into a file for a desktop app's updater, on the thread that calls it, which is not the main one,
// and throws why it could not, as when the answer runs past maxBytes.
void download(const std::string &url, const std::filesystem::path &file, std::uintmax_t maxBytes);
// Throws why not when an update, the app it unpacked to or its setup program, is not signed by the app's own signer: on
// macOS by its code signature, on Windows by its Authenticode signature, which Windows trusts. A leaked key of
// app.updater's then installs nothing else. An app without such a signature, as a Linux app always is, takes any update
// the key signed; a Windows app whose own signature Windows does not trust takes none.
void checkSigner(const std::filesystem::path &update);

// A key and its modifiers, as crossbind/app checks them: the key is A–Z, 0–9, F1–F12 or one of crossbind/app's names,
// and CmdOrCtrl is command on macOS and control elsewhere.
struct Accelerator {
    bool command = false;
    bool control = false;
    bool alt = false;
    bool shift = false;
    std::string key;
    // 1 to 12 for F1 to F12, else 0.
    int function = 0;
};

// An item of the page's menus: a separator, a standard menu or item by its role, a submenu, or one whose clicks the page
// hears of by its id.
struct MenuItem {
    std::string label;
    std::string id;
    std::string role;
    std::optional<Accelerator> accelerator;
    std::optional<bool> checked;
    bool isSeparator = false;
    bool isEnabled = true;
    bool isSubmenu = false;
    std::vector<MenuItem> items;
};

using MenuClicked = std::function<void(std::string id, std::optional<bool> checked)>;
// Sets the app's menus, on the main thread, which calls done; a click of an item with an id calls clicked there, with
// whether a checked one now is.
void setMenu(std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done);

#ifdef __APPLE__
// macOS sends the standard shortcuts, ⌘C and ⌘Q among them, through the menu bar, so a window without the app, Edit,
// View and Window menus never sees them.
void installAppMenu();
// Hears of the links of app.urlSchemes macOS opens the app with, the launch's own as well, which come as Apple Events.
void listenForUrls();
// The page of the webview made from this configuration keeps running while its window is hidden.
void keepRunningWhenHidden(void *configuration);
// Shows an iOS view controller, such as an alert, over whatever the window shows on top; false when it has nothing to
// show it over.
bool presentOnTop(void *controller, void *window);
// A macOS page's navigator.geolocation, to which WKWebView gives no position there, answered from CoreLocation.
void provideLocation(void *webView);
#endif

#ifdef _WIN32
// The ICoreWebView2EnvironmentOptions WebView2's environment is made with: they register the scheme, which pages of
// these other origins may request as well.
void *schemeEnvironmentOptions(const char *scheme, const std::vector<std::string> &origins);
// Starts an update's setup program, which installs it where the app is once the app has quit, and opens it anew.
void runSetup(const std::filesystem::path &setup);
// The webview whose key presses reach the menus' accelerators first, as it holds the keyboard.
void setMenuWebView(void *controller);
// The window fills the screen while the page shows an element full screen, which WebView2 leaves to its host. On the
// main thread.
void followPageFullScreen(void *controller);
// A window that fills its screen fills it again once Windows changes the screen's size or scale. On the main thread.
void fitFullScreen();
// The folder WebView2 keeps the page's profile in: the app's own, on this machine.
std::wstring webViewProfile();
#endif

#pragma once

// What each platform does for the page's menus, a desktop app's tray icon and the system's notifications. Each is called
// on the module's thread, works on the main thread and calls done there with why it failed, or nothing. A platform that
// has no such function throws.
#include "crossbind/extension.h"

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace crossbind::menu {

using Failure = std::optional<std::string>;

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
// Opens a menu of these items at the page's point x, y, in CSS pixels from its top left, as a right click's menu opens,
// on the main thread: done gets there the id of the item clicked, or none when the menu closed without one. A standard
// item does what its role says.
void popupMenu(std::vector<MenuItem> items, double x, double y, std::function<void(Failure, std::optional<std::string> id)> done);
// The menu a macOS app's Dock icon shows above the system's items, on the main thread, which calls done; a click of an
// item with an id calls clicked there. None takes it away.
void setDockMenu(std::vector<MenuItem> items, MenuClicked clicked, std::function<void(Failure)> done);
// The app's icon in the menu bar on macOS, the notification area on Windows and a desktop's status tray on Linux, with
// its tooltip and the menu a click opens. A click of an item with an id calls clicked, and a click of the icon that opens
// no menu tells the page as the event tray. Set again, it changes the icon. On the main thread, which calls done.
struct TrayOptions {
    std::string tooltip;
    std::vector<MenuItem> menu;
};
void setTray(TrayOptions options, MenuClicked clicked, std::function<void(Failure)> done);
void removeTray(std::function<void(Failure)> done);
// A notification of the system's, a click on which tells the page as the event notification. On the main thread, which
// calls done once the system has taken it.
struct Notification {
    std::string title;
    std::string body;
};
void showNotification(Notification notification, std::function<void(Failure)> done);
// What the identifier of each notification showNotification() shows starts with, whose taps the page hears of on macOS.
inline constexpr char NOTIFICATION_ID_PREFIX[] = "crossbind.menu.";

// The app's id, which a Linux tray names itself by on the session bus, as the build gives it in the extension's options.
const std::string &appId();

#if defined(__APPLE__) && !TARGET_OS_IPHONE
// Gives the app's delegate the Dock's menu, none until setDockMenu() sets one, as the window opens: AppKit asks a delegate
// that answered as it was set alone.
void answerDockMenu();
#endif

#if defined(__linux__) && !defined(__ANDROID__)
// The folder of a Linux app's files, resources/ beside its executable, which holds the app's icon.png.
std::string resourceFolder();
// Keeps the webview's last button press, which popupMenu() opens from, as the window opens.
void keepPresses();
#endif

}  // namespace crossbind::menu

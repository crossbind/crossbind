#pragma once

// A desktop app's windows: each one of the platform's with a webview, which the webview library makes in it, and its
// page. desktop_windows.cpp keeps them, and the app quits as the last one closes; a platform makes, shows, changes and
// closes each one. The library is C++ alone, which no Objective-C file of ARC's includes.
#include "app.h"

namespace crossbind::app {

// Readies the platform for the app's windows and opens the first, of app.window's options, before the platform's loop
// runs; one that cannot open throws.
void openFirstWindow(Core &core, const char *devUrl);
// As the user of a window of the app's asks it to close, or another program does, on the main thread: the host closes
// it after the loop's current task, unless an extension keeps it. Whether the host closes it.
bool closeAsked(uint64_t id);

}  // namespace crossbind::app

// What a platform does of a desktop window, on the main thread.
//
// Readies the platform for the app's windows, once, before the first opens.
void startWindows();
// Makes a window of these options, not shown yet, for the library to make its webview in, or null where the library
// makes the window itself, as on Windows: the keys the platform cannot honour join ignored. parent is the platform's
// window of options.parent, or null.
void *makeWindow(const crossbind::app::WindowOptions &options, void *parent, std::vector<std::string> &ignored);
// Readies the window the library made or was given, its webview in it, before its page loads: the window's id is what
// it tells the host of.
void readyWindow(void *window, void *webView, uint64_t id, const crossbind::app::WindowOptions &options, void *parent,
    std::vector<std::string> &ignored);
// Shows a window made so, above its parent, a sheet of it for a modal one on macOS, and full screen if its options ask.
void presentWindow(void *window, void *webView, const crossbind::app::WindowOptions &options, void *parent);
void changeWindow(void *window, void *webView, const crossbind::app::WindowChanges &changes, std::vector<std::string> &ignored);
crossbind::app::WindowState stateOfWindow(void *window, void *webView);
void focusWindow(void *window);
void minimizeWindow(void *window);
void toggleMaximizeWindow(void *window);
void dragWindow(void *window);
// Closes a window the host let close, as letGo lets the library go of its webview, and of the window it made on
// Windows: a modal one's parent takes input again before it goes.
void destroyWindow(void *window, void *parent, bool isModal, const std::function<void()> &letGo);
// Runs the platform's loop until endLoop() ends it, as the app's last window closed.
void runLoop();
void endLoop();

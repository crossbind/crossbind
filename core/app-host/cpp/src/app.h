#pragma once

// What an app does around its webview, whatever makes its window: the module starts from the app's files, and the
// webview gets the page's token, the module's channel, the page's console and the navigation lock.
#include "host_core.h"

namespace crossbind::app {

// The page a debug app opens instead of its own: the dev server's, which CROSSBIND_APP_URL names. Null in a release app.
const char *devUrl();
// Runs the app's extensions' entries, hands a desktop app's launch to the extension that takes its launches, then
// starts the module from the app's files; ends the app where the launch ends, or with the reason where one of them
// fails.
Core &start(const char *devUrl, const Launch *launch = nullptr);
// Ends the app without running destructors: bindings keep JSI values in globals, which must not be destroyed after the
// runtime they belong to.
[[noreturn]] void quit(Core &core, int status);
// Quits the app as quitApp() does, and opens it anew once it has, as app.relaunch() asks. A phone throws as quitApp()
// does, and a desktop development session as well: its dev server opened the app, and would lose it.
void relaunchApp();
// Ends the app for this reason, which its output gets, and its user as well when nobody reads that output.
[[noreturn]] void fail(Core &core, const char *devUrl, const std::string &reason);
// Readies a webview for the page, and returns the URL it opens first. An Android app's activity does this in Java.
std::string attach(Core &core, void *webView, const char *devUrl);
// The scheme and authority of a URL: the origin a webview names a page by.
std::string originOf(const std::string &url);
// A link of the app's schemes the system opened it with, on any thread: the extension that owns its scheme gets it,
// for one of app.urlSchemes the host's links, which holds it for the page as the event open-url.
void openedUrl(const std::string &url);
// The arguments that are links of the app's schemes, as Windows and Linux hand an app its link.
void openUrlsIn(const std::vector<std::string> &args);
// A desktop app's launch, on Windows from its command line as given, whatever the code page.
Launch launchOf(int argc, char **argv);
// A desktop app's module has started, and the first launch's links have gone out: the later launches handed over
// meanwhile reach the app now.
void startTakingLaunches();

}  // namespace crossbind::app

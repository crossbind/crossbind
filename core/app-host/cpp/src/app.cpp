#include "app.h"

#include "crossbind_app.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>

#ifdef __APPLE__
#include <TargetConditionals.h>
#endif

namespace crossbind::app {

namespace {
std::atomic<bool> isOpeningAnew{false};
}  // namespace

std::string originOf(const std::string &url) {
    const auto scheme = url.find("://");
    if (scheme == std::string::npos) return url;
    return url.substr(0, url.find_first_of("/?#", scheme + 3));
}

const char *devUrl() {
#ifdef CROSSBIND_APP_DEV
    return std::getenv("CROSSBIND_APP_URL");
#else
    // A release build loads its own page, whatever starts it.
    return nullptr;
#endif
}

Core &start(const char *devUrl, const Launch *launch) {
    const std::string resources = resourceDir();
    Core &core = *new Core(resources + "/page");
    if (devUrl) core.corsOrigin = originOf(devUrl);
    // An extension's entry reads the launch's arguments already.
    if (launch) firstLaunch() = *launch;
    try {
        startExtensions();
        // A launch that ends here, as one the instance that runs took, skips the static destructors of the app's code,
        // as quit() does, and the extensions' onQuit.
        if (!launched(launch)) {
            std::fflush(nullptr);
            std::_Exit(0);
        }
        started();
    } catch (const std::exception &error) {
        fail(core, devUrl, error.what());
    } catch (...) {
        fail(core, devUrl, "an extension failed as the app started");
    }
    std::string bootError;
    try {
        bootError = core.boot(readFile(resources + "/host.hbc"), "host.hbc", resources + "/data");
    } catch (const std::exception &error) {
        bootError = error.what();
    }
    if (!bootError.empty()) fail(core, devUrl, "the app's module failed to start: " + bootError);
    return core;
}

void quit(Core &core, int status) {
    // The extensions hear the windows close and quit before the module stops, which may take it a while: a later launch
    // of an app kept to one instance then waits for this one to end, and becomes the next.
    windowsClosed();
    quitting();
    core.stop();
    // The instance left, the app this opens becomes the next. An app its user opened has no output, as fail() tells.
    if (status == 0 && isOpeningAnew) {
        if (const Failure failure = openAnew()) {
            std::fprintf(stderr, "crossbind: %s\n", failure->c_str());
            if (!std::getenv("CROSSBIND_APP_CONSOLE")) showError(*failure);
        }
    }
    std::fflush(nullptr);
    std::_Exit(status);
}

void relaunchApp() {
#if defined(CROSSBIND_APP_DEV) && !defined(__ANDROID__) && !TARGET_OS_IPHONE
    throw std::runtime_error("crossbind: a development session does not relaunch the app, which its dev server opened: the built app does");
#else
    isOpeningAnew = true;
    try {
        quitApp();
    } catch (...) {
        isOpeningAnew = false;
        throw;
    }
#endif
}

void fail(Core &core, const char *devUrl, const std::string &reason) {
    // Nor while its box shows.
    quitting();
    std::fprintf(stderr, "crossbind: %s\n", reason.c_str());
    // A development session and a run with CROSSBIND_APP_CONSOLE read the output; an app its user opened has none, and
    // its box shows the reason's first line, without the stack a script's error carries. The module stops first, so
    // nothing runs behind the box.
    if (!devUrl && !std::getenv("CROSSBIND_APP_CONSOLE")) {
        core.stop();
        showError(reason.substr(0, reason.find('\n')));
    }
    quit(core, 1);
}

}  // namespace crossbind::app

#include "app.h"

#include "crossbind_app.h"
#include "instance.h"

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

const char *devUrl() {
#ifdef CROSSBIND_APP_DEV
    return std::getenv("CROSSBIND_APP_URL");
#else
    // A release build loads its own page, whatever starts it.
    return nullptr;
#endif
}

Core &start(const char *devUrl) {
    const std::string resources = resourceDir();
    Core &core = *new Core(resources + "/page");
    core.cors = devUrl != nullptr;
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
#ifdef CROSSBIND_APP_SINGLE_INSTANCE
    // A later launch waits for this instance to end, which may take the module a while, and becomes the next.
    leaveInstance();
#endif
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
#ifdef CROSSBIND_APP_SINGLE_INSTANCE
    // Nor while its box shows.
    leaveInstance();
#endif
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

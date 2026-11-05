// The app's functions as its code and its page call them: the module's code through <crossbind/app.h>, which waits for
// the main thread to do the work, and the page through crossbind/app, which the host answers once the work is done.
#include "app.h"
#include "host_core.h"
// The app's name and options, which crossbind writes for every app's host.
#include "crossbind_app.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <future>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <utility>

namespace crossbind::app {

std::filesystem::path pathOf(const std::string &text) { return std::filesystem::path(std::u8string(text.begin(), text.end())); }

namespace {

// The main thread answers waits from the module's start until the app quits; outside that span a wait would hang.
std::atomic<bool> answering{false};
// How often a wait looks whether the app has begun to quit.
constexpr auto QUIT_CHECK = std::chrono::milliseconds(50);
// What the user picked in a dialog during this run, which allowPath() was given: "picked" in where the page reaches.
std::mutex grantedMutex;
std::vector<std::string> granted;

// Waits for what the main thread hands done. The promise is shared, as done may run after the wait has given up, and a
// done dropped unrun breaks it rather than hang the wait.
template <typename T, typename Start>
T wait(Start start) {
    if (!answering) throw std::runtime_error("crossbind: <crossbind/app.h> answers once the app's module has started, until the app quits");
    if (isMainThread()) {
        throw std::logic_error("crossbind: <crossbind/app.h> waits for the main thread to do the work, so the main thread never calls it: call it from the module's thread or another of the app's own");
    }
    auto result = std::make_shared<std::promise<T>>();
    auto answer = result->get_future();
    start([result](T value) { result->set_value(std::move(value)); });
    result.reset();
    while (answer.wait_for(QUIT_CHECK) == std::future_status::timeout) {
        if (!answering) throw std::runtime_error("crossbind: the app quit before it answered");
    }
    return answer.get();
}

// One of the app's functions, as the page calls it by its name.
Value invoked(const std::string &name, Value options) {
    using Answer = std::pair<Failure, Value>;
    Answer answer = wait<Answer>([&](std::function<void(Answer)> done) {
        app::invoke(name, std::move(options), [done = std::move(done)](Failure failure, Value result) { done({std::move(failure), std::move(result)}); });
    });
    if (answer.first) throw std::runtime_error(*answer.first);
    return std::move(answer.second);
}

Value filtersOf(const std::vector<FileFilter> &filters) {
    Value::Array out;
    for (const auto &filter : filters) out.push_back(Value::Object{{"name", filter.name}, {"extensions", filter.extensions}});
    return out;
}

}  // namespace

void answerWaits(bool answer) { answering = answer; }

std::optional<std::vector<std::string>> openDialog(const OpenOptions &options) {
    const Value picked = invoked("dialog.open", Value::Object{{"title", options.title}, {"defaultPath", options.defaultPath},
        {"filters", filtersOf(options.filters)}, {"directory", options.directory}, {"multiple", options.multiple}});
    if (picked.isNull()) return std::nullopt;
    std::vector<std::string> paths;
    for (const Value &path : picked.asArray()) paths.push_back(path.asString());
    return paths;
}

std::optional<std::string> saveDialog(const SaveOptions &options) {
    const Value file = invoked("dialog.save", Value::Object{{"title", options.title}, {"defaultPath", options.defaultPath},
        {"defaultName", options.defaultName}, {"filters", filtersOf(options.filters)}});
    if (file.isNull()) return std::nullopt;
    return file.asString();
}

int messageDialog(const MessageOptions &options) {
    const char *kind = options.kind == MessageKind::error ? "error" : options.kind == MessageKind::warning ? "warning" : "info";
    return static_cast<int>(invoked("dialog.message", Value::Object{{"message", options.message}, {"detail", options.detail}, {"kind", kind},
        {"buttons", options.buttons}}).asNumber());
}

void openExternal(const std::string &url) { invoked("shell.openExternal", Value::Object{{"url", url}}); }

void openPath(const std::string &path) { invoked("shell.openPath", Value::Object{{"path", path}}); }

void revealInFolder(const std::string &path) { invoked("shell.revealInFolder", Value::Object{{"path", path}}); }

void trash(const std::string &path) { invoked("shell.trash", Value::Object{{"path", path}}); }

Paths paths() { return appPaths(); }

void quit() { quitApp(); }

void relaunch() { relaunchApp(); }

void emitEvent(const std::string &event, const std::string &json) { postEvent(event, json); }

void holdEvent(const std::string &event, const std::string &json) { postEvent(event, json, true); }

std::optional<std::string> checkForUpdate() {
    const Value offered = invoked("updater.check", Value::Object{});
    if (offered.isNull()) return std::nullopt;
    return offered["version"].asString();
}

void installUpdate() { invoked("updater.install", Value::Object{}); }

// Far longer than a link: a system that hands over more opens the app on no link.
constexpr size_t MAX_URL = 1 << 16;

namespace {
// ASCII alone, whatever locale GTK sets.
char lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }

// Who gets a link of the app's schemes: the extension that declared its scheme, or for those of app.urlSchemes the
// host's links, which hands them to the page. None for anything else, as a link of another scheme open -a hands over.
std::optional<std::string> ownerOf(const std::string &url) {
    static const std::vector<std::pair<std::string, std::string>> schemes = urlSchemes();
    const size_t colon = url.find(':');
    if (colon == std::string::npos) return std::nullopt;
    std::string scheme = url.substr(0, colon);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), lower);
    for (const auto &[name, owner] : schemes) {
        if (name == scheme) return owner;
    }
    return std::nullopt;
}
}  // namespace

void openedUrl(const std::string &url) {
    const std::optional<std::string> owner = ownerOf(url);
    if (!owner) return;
    if (url.size() > MAX_URL) {
        std::fprintf(stderr, "crossbind: a link of %zu bytes is longer than the app takes\n", url.size());
        return;
    }
    openUrlOf(*owner, url);
}

void openUrlsIn(const std::vector<std::string> &args) {
    for (const auto &arg : args) openedUrl(arg);
}

#if !defined(__ANDROID__) && !TARGET_OS_IPHONE
namespace {
// The launches handed over while the module started, which nothing could tell the app of yet.
std::mutex earlyMutex;
std::vector<Launch> earlyLaunches;
bool isTakingLaunches = false;
}  // namespace

void startTakingLaunches() {
    std::vector<Launch> early;
    {
        std::lock_guard<std::mutex> lock(earlyMutex);
        isTakingLaunches = true;
        early.swap(earlyLaunches);
    }
    for (auto &launch : early) crossbind::launchedAgain(std::move(launch));
}
#endif

void appFunctions(Registry &registry) {
    registry.function("app.paths", [](Call call) {
        const Paths folders = appPaths();
        call.resolve(Value::Object{{"data", folders.data}, {"cache", folders.cache}, {"logs", folders.logs}});
    });
    // A platform whose apps do not quit themselves throws, and the page hears that alone.
    registry.function("app.quit", [](Call call) {
        quitApp();
        call.resolve();
    });
    registry.function("app.relaunch", [](Call call) {
        relaunchApp();
        call.resolve();
    });
}

void refusedFunctions(Registry &registry) {
    for (const char *name : {"updater.check", "updater.install"}) {
        if (hasFunction(name)) continue;
        registry.function(name, [](Call) {
            throw std::runtime_error(
                "crossbind: this app does not update itself: a desktop app does with app.updater in crossbind.config.js, an iOS or Android "
                "app through its store");
        });
    }
}

}  // namespace crossbind::app

namespace crossbind {

std::string appName() { return CROSSBIND_APP_NAME; }

void allowPath(const std::string &path) {
    std::lock_guard<std::mutex> lock(app::grantedMutex);
    app::granted.push_back(path);
}

std::vector<std::string> allowedPaths() {
    std::lock_guard<std::mutex> lock(app::grantedMutex);
    return app::granted;
}

#if !defined(__ANDROID__) && !TARGET_OS_IPHONE
void launchedAgain(Launch launch) {
    {
        std::lock_guard<std::mutex> lock(app::earlyMutex);
        if (!app::isTakingLaunches) {
            app::earlyLaunches.push_back(std::move(launch));
            return;
        }
    }
    showWindow(launch.token);
    // Each of its links reaches the owner of its scheme alone: one of app.urlSchemes the page hears of as open-url.
    std::vector<std::string> args;
    for (const auto &arg : launch.args) {
        if (!app::ownerOf(arg)) args.push_back(arg);
    }
    app::postEvent("second-instance", Value(Value::Object{{"args", args}, {"cwd", launch.cwd}}).json());
    app::openUrlsIn(launch.args);
}
#endif

}  // namespace crossbind

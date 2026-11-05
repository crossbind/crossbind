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
#include <iterator>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <tuple>
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

// The read-only folder of the files app.files lists, beside the page among the app's resources.
Paths paths() {
    Paths folders = appPaths();
    folders.resources = resourceDir() + "/files";
    return folders;
}

void quit() { quitApp(); }

void requestQuit() {
#if defined(__ANDROID__) || (defined(__APPLE__) && TARGET_OS_IPHONE)
    // Which throws, as a phone's apps quit themselves no more than app.quit() ends them.
    quitApp();
#elif defined(__APPLE__)
    terminateApp();
#else
    onMainThread([] {
        if (isQuitAllowed()) quitApp();
    });
#endif
}

void relaunch() { relaunchApp(); }

void emitEvent(const std::string &event, const std::string &json) { postEvent(event, json); }

void emitEvent(const std::string &event, const std::string &json, uint64_t page) { postEvent(event, json, false, Reach::onePage, page); }

void emitEventToFront(const std::string &event, const std::string &json) { postEvent(event, json, false, Reach::frontPage); }

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
bool isLetter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool isDigit(char c) { return c >= '0' && c <= '9'; }

std::string lowered(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), lower);
    return text;
}

// The scheme of a URL, lowercase: what comes before its colon, a letter, then letters, digits, +, - and ., two at least,
// as one letter is a Windows path's drive. None for what is no URL.
std::optional<std::string> schemeOf(const std::string &text) {
    const size_t colon = text.find(':');
    if (colon == std::string::npos || colon < 2 || !isLetter(text[0])) return std::nullopt;
    for (size_t at = 1; at < colon; ++at) {
        const char c = text[at];
        if (!isLetter(c) && !isDigit(c) && c != '+' && c != '-' && c != '.') return std::nullopt;
    }
    return lowered(text.substr(0, colon));
}

int hexOf(char c) {
    if (isDigit(c)) return c - '0';
    const char low = lower(c);
    return low >= 'a' && low <= 'f' ? low - 'a' + 10 : -1;
}

// Text with its %XX escapes decoded; a % that starts none stays.
std::string decoded(const std::string &text) {
    std::string result;
    for (size_t at = 0; at < text.size(); ++at) {
        const int high = text[at] == '%' && at + 2 < text.size() ? hexOf(text[at + 1]) : -1;
        const int low = high >= 0 ? hexOf(text[at + 2]) : -1;
        if (low < 0) {
            result += text[at];
            continue;
        }
        result += static_cast<char>(high * 16 + low);
        at += 2;
    }
    return result;
}

#if defined(__ANDROID__) || TARGET_OS_IPHONE
// Who gets an https link of app.links: the owner of the entry whose domain is the link's, a *. taking the subdomains of
// the one after it, and whose path the link's decoded one starts with, as Android matches it: of those, the one of the
// longest path, then a domain before a *., then the longest domain.
std::optional<std::string> linkOwnerOf(const std::string &url) {
    static const std::vector<std::pair<std::string, std::string>> links = appLinks();
    const size_t start = url.find("//");
    if (start == std::string::npos) return std::nullopt;
    const size_t end = std::min(url.find_first_of("/?#", start + 2), url.size());
    std::string authority = url.substr(start + 2, end - start - 2);
    // The host comes after the last @, as a browser reads it.
    authority = authority.substr(authority.rfind('@') + 1);
    const std::string host = lowered(authority.substr(0, authority.find(':')));
    const std::string path = end < url.size() && url[end] == '/' ? decoded(url.substr(end, url.find_first_of("?#", end) - end)) : "/";
    std::optional<std::string> owner;
    std::tuple<size_t, bool, size_t> best;
    for (const auto &[link, linkOwner] : links) {
        const size_t slash = std::min(link.find('/'), link.size());
        const std::string domain = link.substr(0, slash);
        const std::string prefix = link.substr(slash);
        const bool isWildcard = domain.rfind("*.", 0) == 0;
        const bool isHost = isWildcard
            ? host.size() > domain.size() - 1 && host.compare(host.size() - (domain.size() - 1), std::string::npos, domain, 1) == 0
            : host == domain;
        const std::tuple<size_t, bool, size_t> rank{prefix.size(), !isWildcard, domain.size()};
        if (!isHost || path.rfind(prefix, 0) != 0 || (owner && rank <= best)) continue;
        owner = linkOwner;
        best = rank;
    }
    return owner;
}
#endif

// Who gets a link of the app's schemes: the extension that declared its scheme, or for those of app.urlSchemes the
// host's links, which hands them to the page; on a phone an https link of app.links as well. None for anything else, as
// a link of another scheme open -a hands over.
std::optional<std::string> ownerOf(const std::string &url) {
    static const std::vector<std::pair<std::string, std::string>> schemes = urlSchemes();
    const std::optional<std::string> scheme = schemeOf(url);
    if (!scheme) return std::nullopt;
#if defined(__ANDROID__) || TARGET_OS_IPHONE
    if (*scheme == "https") return linkOwnerOf(url);
#endif
    for (const auto &[name, owner] : schemes) {
        if (name == *scheme) return owner;
    }
    return std::nullopt;
}

// The local path of a file: URL, percent-decoded, without its query and fragment: none for one of a host other than
// none or localhost, nor for one that holds a NUL, which would end the path early.
std::optional<std::string> pathOfFileUrl(const std::string &url) {
    std::string rest = url.substr(url.find(':') + 1);
    rest = rest.substr(0, rest.find_first_of("?#"));
    if (rest.rfind("//", 0) == 0) {
        const size_t slash = std::min(rest.find('/', 2), rest.size());
        const std::string host = lowered(rest.substr(2, slash - 2));
        if (!host.empty() && host != "localhost") return std::nullopt;
        rest = slash < rest.size() ? rest.substr(slash) : "/";
    }
    std::string path = decoded(rest);
    if (path.find('\0') != std::string::npos) return std::nullopt;
#ifdef _WIN32
    // file:///C:/Users/me names C:/Users/me.
    if (path.size() >= 3 && path[0] == '/' && isLetter(path[1]) && path[2] == ':') path.erase(0, 1);
#endif
    return path;
}

// A launch's file by its absolute path, against the folder it was launched in, as UTF-8.
std::string absoluteOf(const std::string &path, const std::string &cwd) {
    std::filesystem::path full = pathOf(path);
    if (full.is_relative() && !cwd.empty()) full = pathOf(cwd) / full;
    full = full.lexically_normal();
    full.make_preferred();
    const std::u8string text = full.u8string();
    return std::string(text.begin(), text.end());
}

// Whether the app opens files, as app.fileTypes or an extension's declares them: a desktop launch's arguments are its
// files then.
bool opensFiles() {
    static const bool isOpening = !fileTypes().empty();
    return isOpening;
}

// The file a launch's argument names, as Tauri's example of file associations takes them: any argument but an empty
// one, one that starts with "-", a URL other than a file: one and one that names no path, as a file: URL's text that
// is no UTF-8 names none on Windows.
std::optional<std::string> launchFileOf(const std::string &arg, const std::string &cwd) {
    if (arg.empty() || arg[0] == '-') return std::nullopt;
    const std::optional<std::string> scheme = schemeOf(arg);
    if (scheme && *scheme != "file") return std::nullopt;
    const std::optional<std::string> path = scheme ? pathOfFileUrl(arg) : arg;
    if (!path) return std::nullopt;
    try {
        return absoluteOf(*path, cwd);
    } catch (const std::exception &) {
        return std::nullopt;
    }
}

// A launch's own arguments: those that are no link of the app's schemes, which reach their owners, nor, in an app that
// opens files, a file, which reaches the owner of its type.
std::vector<std::string> ownArgs(const Launch &launch) {
    std::vector<std::string> kept;
    std::copy_if(launch.args.begin(), launch.args.end(), std::back_inserter(kept), [&launch](const std::string &arg) {
        return !ownerOf(arg) && !(opensFiles() && launchFileOf(arg, launch.cwd));
    });
    return kept;
}

// Who gets a file: the extension whose types alone list the MIME type it came with, without its parameters, else the
// one that owns its name's extension's type, else the holder of files.
std::string fileOwnerOf(const std::string &path, const std::string &mimeType) {
    static const std::vector<std::pair<std::string, std::string>> mimes = fileMimeTypes();
    std::string mime = lowered(mimeType.substr(0, mimeType.find(';')));
    mime.erase(mime.find_last_not_of(" \t") + 1);
    for (const auto &[type, owner] : mimes) {
        if (!mime.empty() && type == mime) return owner;
    }
    static const std::vector<std::pair<std::string, std::string>> types = fileTypes();
    const size_t name = path.find_last_of("/\\");
    const size_t dot = path.rfind('.');
    if (dot != std::string::npos && (name == std::string::npos || dot > name + 1)) {
        const std::string ending = lowered(path.substr(dot + 1));
        for (const auto &[type, owner] : types) {
            if (type == ending) return owner;
        }
    }
    return holderOf("files");
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

bool continuedActivity(const UserActivity &activity) {
    static const std::vector<std::pair<std::string, std::string>> types = userActivityTypes();
    for (const auto &[type, owner] : types) {
        if (type == activity.type) return continueActivityOf(owner, activity);
    }
    return false;
}

bool shortcutItemTapped(const std::string &type) {
    static const std::vector<std::pair<std::string, std::string>> types = shortcutItemTypes();
    for (const auto &[shortcut, owner] : types) {
        if (shortcut == type) return tapShortcutItemOf(owner, type);
    }
    return false;
}

void openedFiles(const std::vector<std::string> &paths, const std::vector<std::string> &mimeTypes) {
    // Each owner gets its files at once, in their order, each with its MIME type.
    std::vector<std::pair<std::string, OpenFiles>> owned;
    for (size_t index = 0; index < paths.size(); ++index) {
        const std::string mimeType = index < mimeTypes.size() ? mimeTypes[index] : "";
        const std::string owner = fileOwnerOf(paths[index], mimeType);
        auto entry = std::find_if(owned.begin(), owned.end(), [&owner](const auto &other) { return other.first == owner; });
        if (entry == owned.end()) entry = owned.insert(owned.end(), {owner, OpenFiles{}});
        entry->second.paths.push_back(paths[index]);
        entry->second.mimeTypes.push_back(mimeType);
    }
    for (const auto &[owner, files] : owned) openFilesOf(owner, files);
}

void openLaunch(const Launch &launch) {
    openUrlsIn(launch.args);
    if (!opensFiles()) return;
    std::vector<std::string> files;
    for (const auto &arg : launch.args) {
        if (ownerOf(arg)) continue;
        if (const std::optional<std::string> file = launchFileOf(arg, launch.cwd)) files.push_back(*file);
    }
    if (!files.empty()) openedFiles(files);
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
        const Paths folders = paths();
        call.resolve(Value::Object{{"data", folders.data}, {"cache", folders.cache}, {"logs", folders.logs}, {"resources", folders.resources}, {"group", folders.group}});
    });
    // A platform whose apps do not quit themselves throws, and the page hears that alone.
    registry.function("app.quit", [](Call call) {
        quitApp();
        call.resolve();
    });
    registry.function("app.requestQuit", [](Call call) {
        requestQuit();
        call.resolve();
    });
    registry.function("app.relaunch", [](Call call) {
        relaunchApp();
        call.resolve();
    });
    registry.function("app.launchArgs", [](Call call) {
        const Launch launch = crossbind::launchArgs();
        call.resolve(Value::Object{{"args", launch.args}, {"cwd", launch.cwd}});
    });
    windowFunctions(registry);
}

void refusedFunctions(Registry &registry) {
    if (!hasFunction("activities.set")) {
        registry.function("activities.set", [](Call) {
            throw std::runtime_error("crossbind: an iOS or macOS app alone sets a user activity, of a type app.activityTypes in crossbind.config.js lists");
        });
    }
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

std::string appId() { return CROSSBIND_APP_ID; }

// A path that is not absolute, as an empty one, would reach every file the shell's functions take.
void allowPath(const std::string &path) {
    if (!std::filesystem::path(std::u8string(path.begin(), path.end())).is_absolute()) return;
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
    // Each of its links reaches the owner of its scheme alone, on the main thread, in the order of the launches: one of
    // app.urlSchemes the page hears of as open-url. So does each file, in an app that opens files: the page hears of
    // those no extension owns as open-files.
    onMainThread([launch = std::move(launch)] {
        showWindow(launch.token);
        app::postEvent("second-instance", Value(Value::Object{{"args", app::ownArgs(launch)}, {"cwd", launch.cwd}}).json(), false, app::Reach::frontPage);
        app::openLaunch(launch);
    });
}
#endif

Launch launchArgs() {
    Launch launch = app::firstLaunch();
    launch.args = app::ownArgs(launch);
    return launch;
}

}  // namespace crossbind

// The app's functions as its code and its page call them: the module's code through <crossbind/app.h>, which waits for
// the main thread to do the work, and the page through crossbind/app, which the host answers once the work is done.
#include "app.h"
#include "host_core.h"
// Where app.openPath lets the page open files, which crossbind writes for every app's host.
#include "crossbind_app.h"
#include "instance.h"

#include <algorithm>
#include <atomic>
#include <cctype>
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

namespace fs = std::filesystem;

// The main thread answers waits from the module's start until the app quits; outside that span a wait would hang.
std::atomic<bool> answering{false};
// How often a wait looks whether the app has begun to quit.
constexpr auto QUIT_CHECK = std::chrono::milliseconds(50);
// What the user picked in a dialog during this run: "picked" in where the page reaches.
std::mutex grantedMutex;
std::vector<fs::path> granted;

// ASCII alone, whatever locale GTK sets.
char lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }

// An address opens outside the app only when it is one a browser or a mail app takes. It goes on in ASCII, with a space,
// a quote, any other byte and a % that escapes nothing escaped: every system opens it alike, no handler's command line
// splits it, and Windows finds no %VARIABLE% to expand in it.
std::string checkedUrl(const std::string &url) {
    const auto colon = url.find(':');
    std::string scheme = url.substr(0, colon == std::string::npos ? 0 : colon);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), lower);
    const bool hasControl = std::any_of(url.begin(), url.end(), [](unsigned char c) { return c < ' ' || c == 0x7f; });
    if ((scheme != "http" && scheme != "https" && scheme != "mailto") || hasControl) {
        throw std::invalid_argument("crossbind: openExternal opens http, https and mailto addresses alone, not " + url);
    }
    std::string escaped;
    for (size_t i = 0; i < url.size(); i += 1) {
        const unsigned char c = url[i];
        const bool isEscape = c == '%' && i + 2 < url.size() && std::isxdigit(static_cast<unsigned char>(url[i + 1])) &&
                              std::isxdigit(static_cast<unsigned char>(url[i + 2]));
        if (c < 0x80 && c != ' ' && c != '"' && (c != '%' || isEscape)) {
            escaped += static_cast<char>(c);
            continue;
        }
        char hex[4];
        std::snprintf(hex, sizeof hex, "%%%02X", c);
        escaped += hex;
    }
    return escaped;
}

// A relative path would mean the host's own working folder.
void checkPath(const std::string &path, const char *function) {
    if (path.empty() || path.find('\0') != std::string::npos || !pathOf(path).is_absolute()) {
        throw std::invalid_argument(std::string("crossbind: ") + function + " takes an absolute path, not \"" + path + "\"");
    }
}

// A path as written, without a trailing separator: comparing never touches the disk or a network share.
fs::path normal(std::string text) {
#ifdef _WIN32
    // Windows names a file in any case.
    std::transform(text.begin(), text.end(), text.begin(), lower);
#endif
    const fs::path path = pathOf(text).lexically_normal();
    return path.has_filename() ? path : path.parent_path();
}

bool isWithin(const fs::path &path, const fs::path &folder) {
    return std::mismatch(folder.begin(), folder.end(), path.begin(), path.end()).first == folder.end();
}

// The page reaches places by name: the app's folders as app.paths() names them, and "picked", what its dialogs picked, a
// picked folder with what is in it. The app's own code reaches any path.
void checkScope(const std::string &path, const char *function, const std::vector<std::string> &places, const char *rule) {
    // The system follows a link before a .., which leads it elsewhere than the path reads.
    for (const auto &part : pathOf(path)) {
        if (part == "." || part == "..") throw std::invalid_argument(std::string("crossbind: the page's ") + function + " takes a path without . or .., not " + path);
    }
    const fs::path asked = normal(path);
    const Paths folders = appPaths();
    std::vector<fs::path> allowed;
    for (const auto &place : places) {
        if (place == "data") allowed.push_back(normal(folders.data));
        if (place == "cache") allowed.push_back(normal(folders.cache));
        if (place == "logs") allowed.push_back(normal(folders.logs));
        if (place == "picked") {
            std::lock_guard<std::mutex> lock(grantedMutex);
            allowed.insert(allowed.end(), granted.begin(), granted.end());
        }
    }
    if (std::none_of(allowed.begin(), allowed.end(), [&](const fs::path &folder) { return isWithin(asked, folder); })) {
        throw std::invalid_argument(std::string("crossbind: the page's ") + function + " " + rule + ", not " + path +
                                    "; the app's native code reaches any path through <crossbind/app.h>");
    }
}

// Where a path written as normal() writes it leads, the links of the folders above it followed; the system's trash
// follows those and moves the last name itself, a link as well. None when the system cannot tell.
std::optional<fs::path> followedParent(const fs::path &path) {
    std::error_code error;
    const std::u8string parent = fs::weakly_canonical(path.parent_path(), error).u8string();
    if (error) return std::nullopt;
    return normal(std::string(parent.begin(), parent.end())) / path.filename();
}

// A folder written as normal() writes it, its links followed.
fs::path followed(const fs::path &folder) {
    std::error_code error;
    const std::u8string real = fs::weakly_canonical(folder, error).u8string();
    return error ? folder : normal(std::string(real.begin(), real.end()));
}

// The page's trash takes what is in the app's folders, but none of the folders, and what its dialogs picked, both as
// the path is written and where it leads.
void checkTrash(const std::string &path) {
    const char *rule = "trashes what is in the app's folders and what its dialogs picked";
    checkScope(path, "shell.trash", {"data", "cache", "logs", "picked"}, rule);
    const std::optional<fs::path> asked = followedParent(normal(path));
    if (!asked) throw std::invalid_argument("crossbind: the page's shell.trash cannot tell where " + path + " leads");
    const Paths folders = appPaths();
    std::vector<fs::path> allowed;
    for (const auto &folder : {folders.data, folders.cache, folders.logs}) {
        allowed.push_back(followed(normal(folder)));
        if (normal(path) == normal(folder) || *asked == allowed.back()) {
            throw std::invalid_argument("crossbind: the page's shell.trash takes what is in the app's folders, not " + path + " itself");
        }
    }
    {
        // A picked folder's own link is followed as well, and a picked file's is not.
        std::lock_guard<std::mutex> lock(grantedMutex);
        for (const auto &picked : granted) {
            allowed.push_back(followed(picked));
            if (const auto parent = followedParent(picked)) allowed.push_back(*parent);
        }
    }
    if (std::none_of(allowed.begin(), allowed.end(), [&](const fs::path &folder) { return isWithin(*asked, folder); })) {
        throw std::invalid_argument(std::string("crossbind: the page's shell.trash ") + rule + ", not " + path + ", which a link leads out of them");
    }
}

// Waits for what the main thread hands done. The promise is shared, as done may run after the wait has given up, and a
// done dropped unrun breaks it rather than hang the wait.
template <typename T, typename Start>
T wait(Start start) {
    if (!answering) throw std::runtime_error("crossbind: <crossbind/app.h> answers once the app's module has started, until the app quits");
    auto result = std::make_shared<std::promise<T>>();
    auto answer = result->get_future();
    start([result](T value) { result->set_value(std::move(value)); });
    result.reset();
    while (answer.wait_for(QUIT_CHECK) == std::future_status::timeout) {
        if (!answering) throw std::runtime_error("crossbind: the app quit before it answered");
    }
    return answer.get();
}

void waitDone(const std::function<void(std::function<void(Failure)>)> &start) {
    if (const Failure failure = wait<Failure>(start)) throw std::runtime_error(*failure);
}

// One of the app's functions, as the page calls it by its name.
Value invoked(const std::string &name, Value options) {
    using Answer = std::pair<Failure, Value>;
    Answer answer = wait<Answer>([&](std::function<void(Answer)> done) {
        invoke(name, std::move(options), [done = std::move(done)](Failure failure, Value result) { done({std::move(failure), std::move(result)}); });
    });
    if (answer.first) throw std::runtime_error(*answer.first);
    return std::move(answer.second);
}

Value filtersOf(const std::vector<FileFilter> &filters) {
    Value::Array out;
    for (const auto &filter : filters) out.push_back(Value::Object{{"name", filter.name}, {"extensions", filter.extensions}});
    return out;
}

std::function<void(Failure)> answered(Call call) {
    return [call = std::move(call)](Failure failure) {
        if (failure) call.reject(*failure);
        else call.resolve();
    };
}

// The updater downloads, so the page's calls of it run on a thread of their own, which answers them. Without one they
// fail at once on the module's thread: an Android app answers from threads Java knows alone.
void updaterCall(Call call, std::function<Value()> work) {
#ifdef CROSSBIND_APP_UPDATER_URL
    inBackground(std::move(call), std::move(work));
#else
    call.resolve(work());
#endif
}

// The roles crossbind/app takes, which a page that went around it is held to as well.
const std::vector<std::string> MENU_ROLES{"editMenu", "windowMenu", "undo", "redo", "cut", "copy", "paste", "selectAll", "minimize", "close", "quit"};
constexpr int FUNCTION_KEYS = 12;

Accelerator acceleratorOf(const std::string &text) {
    Accelerator accelerator;
    size_t start = 0;
    for (size_t end = text.find('+'); end != std::string::npos; end = text.find('+', start)) {
        const std::string modifier = text.substr(start, end - start);
#ifdef __APPLE__
        const bool isCommand = modifier == "CmdOrCtrl";
#else
        const bool isCommand = false;
#endif
        if (isCommand) {
            accelerator.command = true;
        } else if (modifier == "CmdOrCtrl" || modifier == "Ctrl") {
            accelerator.control = true;
        } else if (modifier == "Alt") {
            accelerator.alt = true;
        } else if (modifier == "Shift") {
            accelerator.shift = true;
        } else {
            throw std::invalid_argument("crossbind: no accelerator has the modifier " + modifier);
        }
        start = end + 1;
    }
    accelerator.key = text.substr(start);
    for (int number = 1; number <= FUNCTION_KEYS; number += 1) {
        if (accelerator.key == "F" + std::to_string(number)) accelerator.function = number;
    }
    return accelerator;
}

#ifndef __APPLE__
// A standard menu off macOS is its standard items, which each platform makes as its apps have them.
MenuItem standardMenu(const MenuItem &menu) {
    const bool isEdit = menu.role == "editMenu";
    MenuItem out;
    out.isSubmenu = true;
    out.label = !menu.label.empty() ? menu.label : isEdit ? "Edit" : "Window";
    const std::vector<std::string> roles = isEdit ? std::vector<std::string>{"undo", "redo", "", "cut", "copy", "paste", "", "selectAll"}
                                                  : std::vector<std::string>{"minimize", "close"};
    for (const auto &role : roles) {
        MenuItem item;
        item.role = role;
        item.isSeparator = role.empty();
        out.items.push_back(std::move(item));
    }
    return out;
}
#endif

std::vector<MenuItem> menuItems(const Value &list) {
    std::vector<MenuItem> out;
    for (const Value &value : list.asArray()) {
        MenuItem item;
        item.label = value["label"].asString("");
        item.id = value["id"].asString("");
        item.role = value["role"].asString("");
        if (!item.role.empty() && std::find(MENU_ROLES.begin(), MENU_ROLES.end(), item.role) == MENU_ROLES.end()) {
            throw std::invalid_argument("crossbind: no menu item has the role " + item.role);
        }
        const std::string accelerator = value["accelerator"].asString("");
        if (!accelerator.empty()) item.accelerator = acceleratorOf(accelerator);
        if (!value["checked"].isNull()) item.checked = value["checked"].asBool();
        item.isEnabled = value["enabled"].asBool(true);
        item.isSeparator = value["type"].asString("") == "separator";
        const Value &children = value["items"];
        item.isSubmenu = !children.isNull();
        if (item.isSubmenu) item.items = menuItems(children);
#ifndef __APPLE__
        if (item.role == "editMenu" || item.role == "windowMenu") item = standardMenu(item);
#endif
        out.push_back(std::move(item));
    }
    return out;
}

// A tray's menu has neither standard items nor keys, and each item but a separator has a label, as crossbind/app holds
// a page to.
void checkTrayItems(const std::vector<MenuItem> &items) {
    for (const auto &item : items) {
        if (!item.role.empty() || item.accelerator) throw std::invalid_argument("crossbind: tray.set's menu takes no role or accelerator");
        if (!item.isSeparator && item.label.empty()) throw std::invalid_argument("crossbind: tray.set's menu has an item without a label");
        checkTrayItems(item.items);
    }
}

// A click the page hears of as the event menu.
void menuClicked(std::string id, std::optional<bool> checked) {
    Value::Object click{{"id", std::move(id)}};
    if (checked) click.emplace_back("checked", *checked);
    postEvent("menu", Value(std::move(click)).json());
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

void openExternal(const std::string &url) {
    const std::string address = checkedUrl(url);
    waitDone([&](std::function<void(Failure)> done) { openUrl(address, std::move(done)); });
}

void openPath(const std::string &path) {
    checkPath(path, "openPath");
    waitDone([&](std::function<void(Failure)> done) { openFile(path, std::move(done)); });
}

void revealInFolder(const std::string &path) {
    checkPath(path, "revealInFolder");
    waitDone([&](std::function<void(Failure)> done) { revealFile(path, std::move(done)); });
}

void trash(const std::string &path) {
    checkPath(path, "trash");
    waitDone([&](std::function<void(Failure)> done) { trashFile(path, std::move(done)); });
}

Paths paths() { return appPaths(); }

void quit() { quitApp(); }

void relaunch() { relaunchApp(); }

void emitEvent(const std::string &event, const std::string &json) { postEvent(event, json); }

// Far longer than a link: a system that hands over more opens the app on no link.
constexpr size_t MAX_URL = 1 << 16;

void openedUrl(const std::string &url) {
    if (url.size() > MAX_URL) {
        std::fprintf(stderr, "crossbind: a link of %zu bytes is longer than the app takes\n", url.size());
        return;
    }
    postEvent("open-url", Value(Value::Object{{"url", url}}).json());
}

#ifdef CROSSBIND_APP_URL_SCHEMES
void openUrlsIn(const std::vector<std::string> &args) {
    static const std::vector<std::string> schemes = CROSSBIND_APP_URL_SCHEMES;
    for (const auto &arg : args) {
        const size_t colon = arg.find(':');
        if (colon == std::string::npos) continue;
        std::string scheme = arg.substr(0, colon);
        std::transform(scheme.begin(), scheme.end(), scheme.begin(), lower);
        if (std::find(schemes.begin(), schemes.end(), scheme) != schemes.end()) openedUrl(arg);
    }
}
#endif

#ifdef CROSSBIND_APP_SINGLE_INSTANCE
namespace {
// The launches handed over while the module started, which nothing could tell the page of yet.
std::mutex earlyMutex;
std::vector<Launch> earlyLaunches;
bool isTakingLaunches = false;
}  // namespace

void launchedAgain(Launch launch) {
    {
        std::lock_guard<std::mutex> lock(earlyMutex);
        if (!isTakingLaunches) {
            earlyLaunches.push_back(std::move(launch));
            return;
        }
    }
    showWindow(launch.token);
    postEvent("second-instance", Value(Value::Object{{"args", launch.args}, {"cwd", launch.cwd}}).json());
#ifdef CROSSBIND_APP_URL_SCHEMES
    openUrlsIn(launch.args);
#endif
}

void startTakingLaunches() {
    std::vector<Launch> early;
    {
        std::lock_guard<std::mutex> lock(earlyMutex);
        isTakingLaunches = true;
        early.swap(earlyLaunches);
    }
    for (auto &launch : early) launchedAgain(std::move(launch));
}
#endif

void appFunctions(Registry &registry) {
    registry.function("shell.openExternal", [](Call call) { openUrl(checkedUrl(call.options()["url"].asString("")), answered(call)); });
    registry.function("shell.openPath", [](Call call) {
        const std::string path = call.options()["path"].asString("");
        checkPath(path, "shell.openPath");
        // Opening a program runs it: the page opens files where the app lets it alone.
        checkScope(path, "shell.openPath", CROSSBIND_APP_OPEN_PATH, "opens what app.openPath in crossbind.config.js lists of data, cache, logs and picked");
        openFile(path, answered(call));
    });
    registry.function("shell.revealInFolder", [](Call call) {
        const std::string path = call.options()["path"].asString("");
        checkPath(path, "shell.revealInFolder");
        checkScope(path, "shell.revealInFolder", {"data", "cache", "logs", "picked"}, "reaches the app's folders and what its dialogs picked");
        revealFile(path, answered(call));
    });
    registry.function("shell.trash", [](Call call) {
        const std::string path = call.options()["path"].asString("");
        checkPath(path, "shell.trash");
        checkTrash(path);
        trashFile(path, answered(call));
    });
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
    registry.function("menu.set", [](Call call) { setMenu(menuItems(call.options()["menus"]), menuClicked, answered(call)); });
    registry.function("tray.set", [](Call call) {
        const Value &options = call.options();
        TrayOptions tray{options["tooltip"].asString(""), options["menu"].isNull() ? std::vector<MenuItem>() : menuItems(options["menu"])};
        checkTrayItems(tray.menu);
        setTray(std::move(tray), menuClicked, answered(call));
    });
    registry.function("tray.remove", [](Call call) { removeTray(answered(call)); });
    registry.function("notification.show", [](Call call) {
        const std::string title = call.options()["title"].asString("");
        if (title.empty()) throw std::invalid_argument("crossbind: notification.show takes a title");
        showNotification({title, call.options()["body"].asString("")}, answered(call));
    });
    registry.function("updater.check", [](Call call) {
        updaterCall(std::move(call), [] {
            const std::optional<std::string> version = checkForUpdate();
            return version ? Value(Value::Object{{"version", *version}}) : Value();
        });
    });
    registry.function("updater.install", [](Call call) {
        updaterCall(std::move(call), [] {
            installUpdate();
            return Value();
        });
    });
}

}  // namespace crossbind::app

namespace crossbind {

std::string appName() { return CROSSBIND_APP_NAME; }

void allowPath(const std::string &path) {
    std::lock_guard<std::mutex> lock(app::grantedMutex);
    app::granted.push_back(app::normal(path));
}

}  // namespace crossbind

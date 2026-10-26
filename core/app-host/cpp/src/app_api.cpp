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
#include <thread>
#include <type_traits>

namespace crossbind::app {

std::filesystem::path pathOf(const std::string &text) { return std::filesystem::path(std::u8string(text.begin(), text.end())); }

namespace {

namespace fs = std::filesystem;

// The main thread answers waits from the module's start until the app quits; outside that span a wait would hang.
std::atomic<bool> answering{false};
// How often a wait looks whether the app has begun to quit.
constexpr auto QUIT_CHECK = std::chrono::milliseconds(50);
// One dialog at a time: another would open inside the first one's modal loop.
std::atomic<bool> dialogOpen{false};
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

void grant(const std::string &path) {
    std::lock_guard<std::mutex> lock(grantedMutex);
    granted.push_back(normal(path));
}

void grant(const std::vector<std::string> &paths) {
    for (const auto &path : paths) grant(path);
}

// An extension goes without its dot, whoever gave it.
template <typename Options>
Options withoutDots(Options options) {
    for (auto &filter : options.filters) {
        for (auto &extension : filter.extensions) {
            if (!extension.empty() && extension[0] == '.') extension.erase(0, 1);
            if (extension.empty()) throw std::invalid_argument("crossbind: the filter " + filter.name + " has an empty extension");
        }
    }
    return options;
}

// Shows a dialog unless one is open.
template <typename Options, typename T>
void showDialog(void (*show)(Options, std::function<void(T)>), std::type_identity_t<Options> options,
                std::type_identity_t<std::function<void(T)>> done) {
    if (dialogOpen.exchange(true)) throw std::runtime_error("crossbind: another dialog is open");
    try {
        show(std::move(options), [done = std::move(done)](T result) {
            dialogOpen = false;
            done(std::move(result));
        });
    } catch (...) {
        dialogOpen = false;
        throw;
    }
}

// A file dialog, whose user's picks the page may reach then.
template <typename Options, typename T>
void showFileDialog(void (*show)(Options, std::function<void(T)>), std::type_identity_t<Options> options,
                    std::type_identity_t<std::function<void(T)>> done) {
    showDialog(show, withoutDots(std::move(options)), [done = std::move(done)](T result) {
        if (result) grant(*result);
        done(std::move(result));
    });
}

// Android's dialogs take three buttons at most.
constexpr size_t MAX_BUTTONS = 3;

// A message dialog, which a page that went around crossbind/app is held to as well; closing it clicks its last button.
void showMessage(MessageOptions options, std::function<void(int)> done) {
    if (options.message.empty()) throw std::invalid_argument("crossbind: a message dialog takes a message");
    const bool hasEmptyLabel = std::any_of(options.buttons.begin(), options.buttons.end(), [](const std::string &label) { return label.empty(); });
    if (options.buttons.size() > MAX_BUTTONS || hasEmptyLabel) {
        throw std::invalid_argument("crossbind: a message dialog takes three buttons at most, each with a label");
    }
    const int last = std::max(static_cast<int>(options.buttons.size()) - 1, 0);
    showDialog(showMessageDialog, std::move(options), [last, done = std::move(done)](int button) { done(button < 0 ? last : button); });
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

std::string json(const std::string &text) {
    std::string out = "\"";
    for (const unsigned char c : text) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            char escaped[7];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
            out += escaped;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out + '"';
}

std::string json(const std::vector<std::string> &items) {
    std::string out = "[";
    for (const auto &item : items) out += (out.size() > 1 ? "," : "") + json(item);
    return out + "]";
}

std::string ok(const std::string &value) { return "[0," + value + "]"; }

std::function<void(Failure)> answered(ReplyFn reply) {
    return [reply = std::move(reply)](Failure failure) { reply(failure ? errorReply(*failure) : ok("null")); };
}

// The updater downloads, so the page's calls of it run on a thread of their own, which answers them. Without one they
// fail at once on the module's thread: an Android app answers from threads Java knows alone.
void inBackground(ReplyFn reply, std::function<std::string()> work) {
    auto answer = [reply = std::move(reply), work = std::move(work)] {
        std::string result;
        try {
            result = work();
        } catch (const std::exception &error) {
            result = errorReply(error.what());
        } catch (...) {
            result = errorReply("crossbind: the updater failed");
        }
        reply(result);
    };
#ifdef CROSSBIND_APP_UPDATER_URL
    std::thread(std::move(answer)).detach();
#else
    answer();
#endif
}

jsi::Value property(jsi::Runtime &rt, const jsi::Value &options, const char *key) {
    return options.isObject() ? options.asObject(rt).getProperty(rt, key) : jsi::Value::undefined();
}

std::string text(jsi::Runtime &rt, const jsi::Value &options, const char *key) {
    const jsi::Value value = property(rt, options, key);
    return value.isUndefined() ? std::string() : value.asString(rt).utf8(rt);
}

bool flag(jsi::Runtime &rt, const jsi::Value &options, const char *key) {
    const jsi::Value value = property(rt, options, key);
    return !value.isUndefined() && value.asBool();
}

std::vector<std::string> texts(jsi::Runtime &rt, const jsi::Value &array) {
    std::vector<std::string> out;
    if (array.isUndefined()) return out;
    const jsi::Array items = array.asObject(rt).asArray(rt);
    for (size_t i = 0; i < items.size(rt); i += 1) out.push_back(items.getValueAtIndex(rt, i).asString(rt).utf8(rt));
    return out;
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

std::vector<MenuItem> menuItems(jsi::Runtime &rt, const jsi::Value &list) {
    std::vector<MenuItem> out;
    const jsi::Array items = list.asObject(rt).asArray(rt);
    for (size_t i = 0; i < items.size(rt); i += 1) {
        const jsi::Value value = items.getValueAtIndex(rt, i);
        MenuItem item;
        item.label = text(rt, value, "label");
        item.id = text(rt, value, "id");
        item.role = text(rt, value, "role");
        if (!item.role.empty() && std::find(MENU_ROLES.begin(), MENU_ROLES.end(), item.role) == MENU_ROLES.end()) {
            throw std::invalid_argument("crossbind: no menu item has the role " + item.role);
        }
        const std::string accelerator = text(rt, value, "accelerator");
        if (!accelerator.empty()) item.accelerator = acceleratorOf(accelerator);
        const jsi::Value checked = property(rt, value, "checked");
        if (!checked.isUndefined()) item.checked = checked.asBool();
        const jsi::Value enabled = property(rt, value, "enabled");
        item.isEnabled = enabled.isUndefined() || enabled.asBool();
        item.isSeparator = text(rt, value, "type") == "separator";
        const jsi::Value children = property(rt, value, "items");
        item.isSubmenu = !children.isUndefined();
        if (item.isSubmenu) item.items = menuItems(rt, children);
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
    postEvent("menu", "{\"id\":" + json(id) + (checked ? std::string(",\"checked\":") + (*checked ? "true" : "false") : "") + "}");
}

std::vector<FileFilter> filters(jsi::Runtime &rt, const jsi::Value &options) {
    std::vector<FileFilter> out;
    const jsi::Value value = property(rt, options, "filters");
    if (value.isUndefined()) return out;
    const jsi::Array items = value.asObject(rt).asArray(rt);
    for (size_t i = 0; i < items.size(rt); i += 1) {
        const jsi::Value filter = items.getValueAtIndex(rt, i);
        out.push_back({text(rt, filter, "name"), texts(rt, property(rt, filter, "extensions"))});
    }
    return out;
}

MessageKind kindOf(const std::string &kind) {
    if (kind.empty() || kind == "info") return MessageKind::info;
    if (kind == "warning") return MessageKind::warning;
    if (kind == "error") return MessageKind::error;
    throw std::invalid_argument("crossbind: no message dialog has the kind " + kind);
}

}  // namespace

void answerWaits(bool answer) { answering = answer; }

std::optional<std::vector<std::string>> openDialog(const OpenOptions &options) {
    return wait<Picked>([&](std::function<void(Picked)> done) { showFileDialog(showOpenDialog, options, std::move(done)); });
}

std::optional<std::string> saveDialog(const SaveOptions &options) {
    return wait<std::optional<std::string>>(
        [&](std::function<void(std::optional<std::string>)> done) { showFileDialog(showSaveDialog, options, std::move(done)); });
}

int messageDialog(const MessageOptions &options) {
    return wait<int>([&](std::function<void(int)> done) { showMessage(options, std::move(done)); });
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
    postEvent("open-url", "{\"url\":" + json(url) + "}");
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
    postEvent("second-instance", "{\"args\":" + json(launch.args) + ",\"cwd\":" + json(launch.cwd) + "}");
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

void callApp(jsi::Runtime &rt, const std::string &name, const jsi::Value &options, ReplyFn reply) {
    try {
        if (name == "dialog.open") {
            OpenOptions open{text(rt, options, "title"), text(rt, options, "defaultPath"), filters(rt, options),
                             flag(rt, options, "directory"), flag(rt, options, "multiple")};
            showFileDialog(showOpenDialog, std::move(open), [reply](Picked picked) { reply(ok(picked ? json(*picked) : "null")); });
        } else if (name == "dialog.save") {
            SaveOptions save{text(rt, options, "title"), text(rt, options, "defaultPath"), text(rt, options, "defaultName"),
                             filters(rt, options)};
            showFileDialog(showSaveDialog, std::move(save), [reply](std::optional<std::string> file) { reply(ok(file ? json(*file) : "null")); });
        } else if (name == "dialog.message") {
            showMessage({text(rt, options, "message"), text(rt, options, "detail"), kindOf(text(rt, options, "kind")),
                         texts(rt, property(rt, options, "buttons"))},
                        [reply](int button) { reply(ok(std::to_string(button))); });
        } else if (name == "shell.openExternal") {
            openUrl(checkedUrl(text(rt, options, "url")), answered(reply));
        } else if (name == "shell.openPath") {
            const std::string path = text(rt, options, "path");
            checkPath(path, "shell.openPath");
            // Opening a program runs it: the page opens files where the app lets it alone.
            checkScope(path, "shell.openPath", CROSSBIND_APP_OPEN_PATH,
                       "opens what app.openPath in crossbind.config.js lists of data, cache, logs and picked");
            openFile(path, answered(reply));
        } else if (name == "shell.revealInFolder") {
            const std::string path = text(rt, options, "path");
            checkPath(path, "shell.revealInFolder");
            checkScope(path, "shell.revealInFolder", {"data", "cache", "logs", "picked"}, "reaches the app's folders and what its dialogs picked");
            revealFile(path, answered(reply));
        } else if (name == "shell.trash") {
            const std::string path = text(rt, options, "path");
            checkPath(path, "shell.trash");
            checkTrash(path);
            trashFile(path, answered(reply));
        } else if (name == "app.paths") {
            const Paths folders = appPaths();
            reply(ok("{\"data\":" + json(folders.data) + ",\"cache\":" + json(folders.cache) + ",\"logs\":" + json(folders.logs) + "}"));
        } else if (name == "app.quit") {
            // A platform whose apps do not quit themselves throws, and the page hears that alone.
            quitApp();
            reply(ok("null"));
        } else if (name == "app.relaunch") {
            relaunchApp();
            reply(ok("null"));
        } else if (name == "menu.set") {
            setMenu(menuItems(rt, property(rt, options, "menus")), menuClicked, answered(reply));
        } else if (name == "tray.set") {
            const jsi::Value items = property(rt, options, "menu");
            TrayOptions tray{text(rt, options, "tooltip"), items.isUndefined() ? std::vector<MenuItem>() : menuItems(rt, items)};
            checkTrayItems(tray.menu);
            setTray(std::move(tray), menuClicked, answered(reply));
        } else if (name == "tray.remove") {
            removeTray(answered(reply));
        } else if (name == "notification.show") {
            const std::string title = text(rt, options, "title");
            if (title.empty()) throw std::invalid_argument("crossbind: notification.show takes a title");
            showNotification({title, text(rt, options, "body")}, answered(reply));
        } else if (name == "updater.check") {
            inBackground(reply, [] {
                const std::optional<std::string> version = checkForUpdate();
                return ok(version ? "{\"version\":" + json(*version) + "}" : "null");
            });
        } else if (name == "updater.install") {
            inBackground(reply, [] {
                installUpdate();
                return ok("null");
            });
        } else {
            throw std::invalid_argument("crossbind: an app has no function " + name);
        }
    } catch (const std::exception &error) {
        reply(errorReply(error.what()));
    }
}

}  // namespace crossbind::app

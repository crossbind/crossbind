// crossbind/app's windows: the host's functions behind windows.*, which read their options again, as crossbind/app checked
// them, and call the platform's windows on the main thread.
#include "host_core.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace crossbind::app {

#if defined(__ANDROID__)

void windowFunctions(Registry &registry) {
    for (const char *name : {"windows.open", "windows.set", "windows.close", "windows.focus", "windows.minimize", "windows.toggleMaximize",
             "windows.startDrag", "windows.list", "windows.current"}) {
        registry.function(name, [](Call) { throw std::runtime_error("crossbind: an Android app has one window, its activity's, which windows does not reach"); });
    }
}

#else

namespace {

constexpr int MAX_SIZE = 16384;
constexpr int MAX_PLACE = 1000000;

// A whole number of logical pixels from least to most.
int wholeOf(const Value &value, const char *key, int least, int most) {
    if (!value.isNumber() || std::floor(value.asNumber()) != value.asNumber() || value.asNumber() < least || value.asNumber() > most) {
        throw std::invalid_argument(std::string("crossbind: windows' ") + key + " is no whole number from " + std::to_string(least) + " to " +
                                    std::to_string(most));
    }
    return static_cast<int>(value.asNumber());
}

bool boolOf(const Value &value, const char *key) {
    if (!value.isBool()) throw std::invalid_argument(std::string("crossbind: windows' ") + key + " is no boolean");
    return value.asBool();
}

std::string textOf(const Value &value, const char *key) {
    if (!value.isString()) throw std::invalid_argument(std::string("crossbind: windows' ") + key + " is no string");
    return value.asString();
}

uint64_t idOf(const Value &value) {
    if (!value.isNumber() || std::floor(value.asNumber()) != value.asNumber() || value.asNumber() < 1) {
        throw std::invalid_argument("crossbind: a window's id is a whole number from 1, as windows.open() gave it");
    }
    return static_cast<uint64_t>(value.asNumber());
}

// The window a call names, or the calling page's own.
uint64_t windowOfCall(const Call &call) {
    const Value &id = call.options()["id"];
    if (!id.isNull()) return idOf(id);
    if (call.page().windowId() == 0) throw std::invalid_argument("crossbind: a call of no page's window names the window by its id");
    return call.page().windowId();
}

// Whether a part of a path names its folder or the one above, as . and .. do, written so or with %2e.
bool isDotPart(const std::string &part) {
    std::string plain;
    for (size_t at = 0; at < part.size(); at += 1) {
        const bool isEncoded = part.compare(at, 2, "%2") == 0 && at + 2 < part.size() && (part[at + 2] == 'e' || part[at + 2] == 'E');
        plain += isEncoded ? '.' : part[at];
        if (isEncoded) at += 2;
    }
    return plain == "." || plain == "..";
}

// A path of the app's own pages, maybe with a query and a hash, as crossbind/app checked it: no URL of its own, and no
// part that leaves the page's folder.
std::string pathOf(const Value &value) {
    std::string path = textOf(value, "path");
    bool isOwn = !path.empty() && path[0] == '/' && path.compare(0, 2, "//") != 0;
    const std::string withoutQuery = path.substr(0, path.find_first_of("?#"));
    for (size_t start = 0; isOwn && start <= withoutQuery.size();) {
        const size_t end = std::min(withoutQuery.find('/', start), withoutQuery.size());
        const std::string part = withoutQuery.substr(start, end - start);
        isOwn = !isDotPart(part) && part.find('\\') == std::string::npos;
        start = end + 1;
    }
    if (!isOwn) throw std::invalid_argument("crossbind: windows.open()'s path " + path + " is no path of the app's own pages, as /settings.html is");
    return path;
}

bool isTitleBarHidden(const Value &value) {
    const std::string titleBar = textOf(value, "titleBar");
    if (titleBar != "visible" && titleBar != "hidden") {
        throw std::invalid_argument("crossbind: windows.open()'s titleBar " + titleBar + " is neither visible nor hidden");
    }
    return titleBar == "hidden";
}

std::uint32_t colorOf(const Value &value) {
    const std::string color = textOf(value, "backgroundColor");
    if (color.size() != 7 || color[0] != '#' || color.find_first_not_of("0123456789abcdefABCDEF", 1) != std::string::npos) {
        throw std::invalid_argument("crossbind: windows' backgroundColor " + color + " is no color of the form #rrggbb");
    }
    return static_cast<std::uint32_t>(std::stoul(color.substr(1), nullptr, 16));
}

WindowOptions openOptionsOf(const Value &given) {
    WindowOptions options;
    options.title = appName();
    for (const auto &[key, value] : given.asObject()) {
        if (key == "path") options.path = pathOf(value);
        else if (key == "title") options.title = textOf(value, "title");
        else if (key == "name") options.name = textOf(value, "name");
        else if (key == "width") options.width = wholeOf(value, "width", 1, MAX_SIZE);
        else if (key == "height") options.height = wholeOf(value, "height", 1, MAX_SIZE);
        else if (key == "minWidth") options.minWidth = wholeOf(value, "minWidth", 1, MAX_SIZE);
        else if (key == "minHeight") options.minHeight = wholeOf(value, "minHeight", 1, MAX_SIZE);
        else if (key == "maxWidth") options.maxWidth = wholeOf(value, "maxWidth", 1, MAX_SIZE);
        else if (key == "maxHeight") options.maxHeight = wholeOf(value, "maxHeight", 1, MAX_SIZE);
        else if (key == "resizable") options.resizable = boolOf(value, "resizable");
        else if (key == "fullscreen") options.fullscreen = boolOf(value, "fullscreen");
        else if (key == "backgroundColor") options.backgroundColor = colorOf(value);
        else if (key == "x") options.x = wholeOf(value, "x", -MAX_PLACE, MAX_PLACE);
        else if (key == "y") options.y = wholeOf(value, "y", -MAX_PLACE, MAX_PLACE);
        else if (key == "alwaysOnTop") options.alwaysOnTop = boolOf(value, "alwaysOnTop");
        else if (key == "frame") options.frame = boolOf(value, "frame");
        else if (key == "titleBar") options.titleBarHidden = isTitleBarHidden(value);
        else if (key == "parent") options.parent = idOf(value);
        else if (key == "modal") options.modal = boolOf(value, "modal");
        else throw std::invalid_argument("crossbind: windows.open() takes no " + key);
    }
    if (options.x.has_value() != options.y.has_value()) throw std::invalid_argument("crossbind: windows.open() takes x and y together");
    if (!options.frame && options.titleBarHidden) {
        throw std::invalid_argument("crossbind: windows.open() hides the title bar of a window with a frame alone: drop titleBar, or frame: false");
    }
    // The limits, as app.window takes them: those of a window that resizes, around the size it opens at.
    if (!options.resizable && (options.minWidth || options.minHeight || options.maxWidth || options.maxHeight)) {
        throw std::invalid_argument("crossbind: windows.open()'s limits are those of a window that resizes: drop them, or leave resizable true");
    }
    if (options.minWidth > options.width || options.minHeight > options.height) {
        throw std::invalid_argument("crossbind: windows.open()'s minimum size is above the size the window opens at");
    }
    if ((options.maxWidth && options.maxWidth < options.width) || (options.maxHeight && options.maxHeight < options.height)) {
        throw std::invalid_argument("crossbind: windows.open()'s maximum size is below the size the window opens at");
    }
    if (options.modal && options.parent == 0) throw std::invalid_argument("crossbind: a modal window needs a parent: give windows.open() its id");
    if (options.parent != 0 && !windowOf(options.parent)) {
        throw std::invalid_argument("crossbind: windows.open()'s parent " + std::to_string(options.parent) + " is no open window");
    }
    return options;
}

WindowChanges changesOf(const Value &given) {
    WindowChanges changes;
    for (const auto &[key, value] : given.asObject()) {
        if (key == "id") continue;
        if (key == "title") changes.title = textOf(value, "title");
        else if (key == "width") changes.width = wholeOf(value, "width", 1, MAX_SIZE);
        else if (key == "height") changes.height = wholeOf(value, "height", 1, MAX_SIZE);
        else if (key == "x") changes.x = wholeOf(value, "x", -MAX_PLACE, MAX_PLACE);
        else if (key == "y") changes.y = wholeOf(value, "y", -MAX_PLACE, MAX_PLACE);
        else if (key == "center") changes.center = boolOf(value, "center");
        else if (key == "minWidth") changes.minWidth = wholeOf(value, "minWidth", 0, MAX_SIZE);
        else if (key == "minHeight") changes.minHeight = wholeOf(value, "minHeight", 0, MAX_SIZE);
        else if (key == "maxWidth") changes.maxWidth = wholeOf(value, "maxWidth", 0, MAX_SIZE);
        else if (key == "maxHeight") changes.maxHeight = wholeOf(value, "maxHeight", 0, MAX_SIZE);
        else if (key == "resizable") changes.resizable = boolOf(value, "resizable");
        else if (key == "alwaysOnTop") changes.alwaysOnTop = boolOf(value, "alwaysOnTop");
        else if (key == "fullscreen") changes.fullscreen = boolOf(value, "fullscreen");
        else throw std::invalid_argument("crossbind: windows.set() takes no " + key);
    }
    if (changes.x.has_value() != changes.y.has_value()) throw std::invalid_argument("crossbind: windows.set() takes x and y together");
    return changes;
}

Value ignoredOf(const std::vector<std::string> &ignored) {
    Value::Array keys;
    for (const auto &key : ignored) keys.emplace_back(key);
    return Value(std::move(keys));
}

// An open window as windows.list() tells of it.
Value windowValue(uint64_t id) {
    const WindowState state = appWindowState(id);
    const std::string name = nameOfWindow(id);
    return Value::Object{{"id", static_cast<double>(id)},
        {"name", name.empty() ? Value() : Value(name)},
        {"title", state.title},
        {"x", state.x},
        {"y", state.y},
        {"width", state.width},
        {"height", state.height},
        {"isMaximized", state.isMaximized},
        {"isMinimized", state.isMinimized},
        {"isFullscreen", state.isFullscreen},
        {"isFocused", state.isFocused}};
}

// A function of windows.*, which runs on the main thread and answers there: what it throws fails the call.
void onMain(Registry &registry, const char *name, std::function<Value(const Call &)> fn) {
    registry.function(name, [fn = std::move(fn)](Call call) {
        onMainThread([call, fn] {
            try {
                call.resolve(fn(call));
            } catch (const std::exception &error) {
                call.reject(error.what());
            }
        });
    });
}

}  // namespace

void windowFunctions(Registry &registry) {
    registry.function("windows.open", [](Call call) {
        onMainThread([call] {
            try {
                openAppWindow(openOptionsOf(call.options()), [call](std::optional<std::string> failure, uint64_t id, std::vector<std::string> ignored) {
                    if (failure) call.reject(*failure);
                    else call.resolve(Value::Object{{"id", static_cast<double>(id)}, {"ignored", ignoredOf(ignored)}});
                });
            } catch (const std::exception &error) {
                call.reject(error.what());
            }
        });
    });
    onMain(registry, "windows.set", [](const Call &call) {
        const WindowChanges changes = changesOf(call.options());
        std::vector<std::string> ignored;
        changeAppWindow(windowOfCall(call), changes, ignored);
        return Value(Value::Object{{"ignored", ignoredOf(ignored)}});
    });
    onMain(registry, "windows.close", [](const Call &call) {
        closeAppWindow(windowOfCall(call));
        return Value();
    });
    onMain(registry, "windows.focus", [](const Call &call) {
        focusAppWindow(windowOfCall(call));
        return Value();
    });
    onMain(registry, "windows.minimize", [](const Call &call) {
        minimizeAppWindow(windowOfCall(call));
        return Value();
    });
    onMain(registry, "windows.toggleMaximize", [](const Call &call) {
        toggleMaximizeAppWindow(windowOfCall(call));
        return Value();
    });
    onMain(registry, "windows.startDrag", [](const Call &call) {
        dragAppWindow(windowOfCall(call));
        return Value();
    });
    onMain(registry, "windows.list", [](const Call &) {
        Value::Array all;
        for (const Window &window : openWindows()) all.push_back(windowValue(window.id()));
        return Value(std::move(all));
    });
    onMain(registry, "windows.current", [](const Call &call) { return windowValue(windowOfCall(call)); });
}

#endif

}  // namespace crossbind::app

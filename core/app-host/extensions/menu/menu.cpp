// The page's menus, a desktop app's tray icon and the system's notifications, which crossbind/app's menu, tray and
// notification call: the items the page gives, held to what crossbind/app holds a page to, and what each platform shows
// of them. The host's own extension, it adds the functions of tray and notification beside menu's.
#include "menu.h"

#include "crossbind/app.h"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace crossbind::menu {
namespace {

std::string trayId;

std::function<void(Failure)> answered(Call call) {
    return [call = std::move(call)](Failure failure) {
        if (failure) call.reject(*failure);
        else call.resolve();
    };
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

// A tray's menu and the Dock's have neither standard items nor keys, and each item but a separator has a label, as
// crossbind/app holds a page to.
void checkTrayItems(const std::vector<MenuItem> &items, const std::string &menu) {
    for (const auto &item : items) {
        if (!item.role.empty() || item.accelerator) throw std::invalid_argument("crossbind: " + menu + " takes no role or accelerator");
        if (!item.isSeparator && item.label.empty()) throw std::invalid_argument("crossbind: " + menu + " has an item without a label");
        checkTrayItems(item.items, menu);
    }
}

// A click the pages hear of as the event menu: one in a window's menus reaches the page that window shows, and one in the
// tray's menu or the Dock's the page in front that listens.
void menuClicked(uint64_t window, std::string id, std::optional<bool> checked) {
    Value::Object click{{"id", std::move(id)}};
    if (checked) click.emplace_back("checked", *checked);
    const std::string json = Value(std::move(click)).json();
#if !defined(__ANDROID__)
    if (window != 0) {
        if (const std::optional<Window> open = windowOf(window)) app::emitEvent("menu", json, open->page().id());
        return;
    }
#endif
    app::emitEventToFront("menu", json);
}

// The window of the page whose call sets menus or opens one: the app's own code has none. A phone's platform refuses
// menus itself.
uint64_t windowOfCall(const Call &call) {
    const uint64_t window = call.page().windowId();
#if !defined(__ANDROID__) && !TARGET_OS_IPHONE
    if (window == 0) throw std::invalid_argument("crossbind: " + call.name() + " sets the menus of a page's window, which the app's own code has none of");
#endif
    return window;
}

}  // namespace

const std::string &appId() { return trayId; }

}  // namespace crossbind::menu

void crossbind_extension_menu(crossbind::Registry &registry) {
    using namespace crossbind::menu;
    using crossbind::Call;
    trayId = registry.options()["id"].asString("");
#if defined(__linux__) && !defined(__ANDROID__)
    registry.onWindow([](const crossbind::Window &window) { keepPresses(window.webView()); });
#elif defined(__APPLE__) && !TARGET_OS_IPHONE
    registry.onWindow([](const crossbind::Window &) { answerDockMenu(); });
#endif
    registry.onWindowClosed([](const crossbind::Window &window) { dropMenus(window.id()); });
#ifdef _WIN32
    registry.onQuit(quitTray);
#endif
    registry.function("menu.set", [](Call call) {
        std::vector<MenuItem> menus = menuItems(call.options()["menus"]);
        setMenu(windowOfCall(call), std::move(menus), menuClicked, answered(call));
    });
    registry.function("menu.popup", [](Call call) {
        const crossbind::Value &options = call.options();
        std::vector<MenuItem> items = menuItems(options["items"]);
        popupMenu(windowOfCall(call), std::move(items), options["x"].asNumber(), options["y"].asNumber(), [call](Failure failure, std::optional<std::string> id) {
            if (failure) {
                call.reject(*failure);
            } else {
                call.resolve(id ? crossbind::Value(*id) : crossbind::Value());
            }
        });
    });
    registry.function("tray.set", [](Call call) {
        const crossbind::Value &options = call.options();
        TrayOptions tray{options["tooltip"].asString(""), options["menu"].isNull() ? std::vector<MenuItem>() : menuItems(options["menu"])};
        checkTrayItems(tray.menu, "tray.set's menu");
        setTray(std::move(tray), menuClicked, answered(call));
    });
    registry.function("tray.remove", [](Call call) { removeTray(answered(call)); });
    registry.function("menu.setDock", [](Call call) {
        std::vector<MenuItem> items = menuItems(call.options()["items"]);
        checkTrayItems(items, "menu.setDock's menu");
        setDockMenu(std::move(items), menuClicked, answered(call));
    });
    // A tap of one of showNotification()'s, which the host's notification center hands over on macOS: a push's sender
    // names its own.
    registry.onNotification([](const crossbind::Notification &notification) {
        if (notification.isTap() && !notification.isRemote() && notification.id().rfind(NOTIFICATION_ID_PREFIX, 0) == 0) {
            crossbind::app::emitEventToFront("notification");
        }
    });
    registry.function("notification.show", [](Call call) {
        const std::string title = call.options()["title"].asString("");
        if (title.empty()) throw std::invalid_argument("crossbind: notification.show takes a title");
        showNotification({title, call.options()["body"].asString("")}, answered(call));
    });
}

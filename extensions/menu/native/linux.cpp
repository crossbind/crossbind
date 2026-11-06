// The page's menus on Linux: a GTK menu bar above the webview.
#include "menu.h"

#include "crossbind/app.h"

#include <gtk/gtk.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <climits>
#include <map>
#include <memory>
#include <stdexcept>

namespace crossbind::menu {
namespace {

// Each window's bar, by the window's id, and the accelerators that come with it.
struct Bar {
    GtkWidget *bar = nullptr;
    GtkAccelGroup *accelerators = nullptr;
};
std::map<uint64_t, Bar> bars;
// The webviews' last button press, which a popup opens from, as Wayland asks of one, and when it came: a press too old
// for a grab, as a contextmenu of the keyboard follows none, gives way to none.
GdkEvent *lastPress = nullptr;
gint64 lastPressTime = 0;
constexpr gint64 FRESH_PRESS_US = 1000000;
// Whether a popup of the page's shows, beside which the page opens none.
bool isPopupOpen = false;

// What a click of an item does: one of the page's tells its menu's owner its id, a standard one does what its role says,
// to the window whose menus it is in.
struct Action {
    uint64_t window;
    std::string id;
    std::string role;
    MenuClicked clicked;
};

// A standard item's label and accelerator, as GTK apps have them.
struct Role {
    const char *label;
    guint key;
    GdkModifierType modifiers;
};

constexpr auto CONTROL = GDK_CONTROL_MASK;
const std::map<std::string, Role> ROLES{
    {"undo", {"Undo", GDK_KEY_z, CONTROL}},
    {"redo", {"Redo", GDK_KEY_z, static_cast<GdkModifierType>(CONTROL | GDK_SHIFT_MASK)}},
    {"cut", {"Cut", GDK_KEY_x, CONTROL}},
    {"copy", {"Copy", GDK_KEY_c, CONTROL}},
    {"paste", {"Paste", GDK_KEY_v, CONTROL}},
    {"selectAll", {"Select All", GDK_KEY_a, CONTROL}},
    {"minimize", {"Minimize", 0, static_cast<GdkModifierType>(0)}},
    {"close", {"Close", GDK_KEY_w, CONTROL}},
    {"quit", {"Quit", GDK_KEY_q, CONTROL}},
};

const std::map<std::string, const char *> EDITING_COMMANDS{
    {"undo", WEBKIT_EDITING_COMMAND_UNDO}, {"redo", WEBKIT_EDITING_COMMAND_REDO},
    {"cut", WEBKIT_EDITING_COMMAND_CUT},   {"copy", WEBKIT_EDITING_COMMAND_COPY},
    {"paste", WEBKIT_EDITING_COMMAND_PASTE}, {"selectAll", WEBKIT_EDITING_COMMAND_SELECT_ALL},
};

const std::map<std::string, guint> NAMED_KEYS{
    {"Enter", GDK_KEY_Return}, {"Escape", GDK_KEY_Escape}, {"Tab", GDK_KEY_Tab},         {"Space", GDK_KEY_space},
    {"Backspace", GDK_KEY_BackSpace}, {"Delete", GDK_KEY_Delete}, {"Up", GDK_KEY_Up},       {"Down", GDK_KEY_Down},
    {"Left", GDK_KEY_Left},    {"Right", GDK_KEY_Right},   {"Home", GDK_KEY_Home},       {"End", GDK_KEY_End},
    {"PageUp", GDK_KEY_Page_Up}, {"PageDown", GDK_KEY_Page_Down}, {"Plus", GDK_KEY_plus}, {"Minus", GDK_KEY_minus},
    {"Comma", GDK_KEY_comma},  {"Period", GDK_KEY_period},
};

guint keyOf(const Accelerator &accelerator) {
    const std::string &key = accelerator.key;
    if (accelerator.function) return GDK_KEY_F1 + static_cast<guint>(accelerator.function) - 1;
    if (key.size() == 1) return gdk_unicode_to_keyval(static_cast<guint32>(g_ascii_tolower(key[0])));
    const auto named = NAMED_KEYS.find(key);
    if (named == NAMED_KEYS.end()) throw std::invalid_argument("crossbind: no accelerator has the key " + key);
    return named->second;
}

void runRole(uint64_t window, const std::string &role) {
    if (role == "quit") {
        app::requestQuit();
        return;
    }
    const std::optional<Window> open = windowOf(window);
    if (!open) return;
    if (const auto command = EDITING_COMMANDS.find(role); command != EDITING_COMMANDS.end()) {
        webkit_web_view_execute_editing_command(WEBKIT_WEB_VIEW(open->webView()), command->second);
    } else if (role == "minimize") {
        gtk_window_iconify(GTK_WINDOW(open->native()));
    } else {
        gtk_window_close(GTK_WINDOW(open->native()));
    }
}

void activated(GtkMenuItem *item, gpointer data) {
    const Action &action = *static_cast<Action *>(data);
    if (!action.role.empty()) {
        runRole(action.window, action.role);
        return;
    }
    std::optional<bool> checked;
    if (GTK_IS_CHECK_MENU_ITEM(item)) checked = gtk_check_menu_item_get_active(GTK_CHECK_MENU_ITEM(item)) != FALSE;
    if (action.clicked && !action.id.empty()) action.clicked(action.window, action.id, checked);
}

void connect(GtkWidget *item, Action action) {
    g_signal_connect_data(item, "activate", G_CALLBACK(activated), new Action(std::move(action)),
                          [](gpointer data, GClosure *) { delete static_cast<Action *>(data); }, static_cast<GConnectFlags>(0));
}

void addItem(GtkMenuShell *shell, const MenuItem &page, uint64_t window, GtkAccelGroup *accelerators, const MenuClicked &clicked);

// Each item goes in its shell before what may throw, so the bar destroys it with itself.
void addMenu(GtkMenuShell *shell, const std::string &label, const std::vector<MenuItem> &items, uint64_t window, GtkAccelGroup *accelerators,
             const MenuClicked &clicked) {
    GtkWidget *holder = gtk_menu_item_new_with_label(label.c_str());
    GtkWidget *menu = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(holder), menu);
    gtk_menu_shell_append(shell, holder);
    for (const auto &child : items) addItem(GTK_MENU_SHELL(menu), child, window, accelerators, clicked);
}

void addItem(GtkMenuShell *shell, const MenuItem &page, uint64_t window, GtkAccelGroup *accelerators, const MenuClicked &clicked) {
    if (page.isSeparator) {
        gtk_menu_shell_append(shell, gtk_separator_menu_item_new());
        return;
    }
    if (page.isSubmenu) {
        addMenu(shell, page.label, page.items, window, accelerators, clicked);
        return;
    }
    GtkWidget *made = nullptr;
    if (!page.role.empty()) {
        const auto role = ROLES.find(page.role);
        if (role == ROLES.end()) throw std::invalid_argument("crossbind: no menu item has the role " + page.role);
        made = gtk_menu_item_new_with_label(page.label.empty() ? role->second.label : page.label.c_str());
        if (!page.accelerator && role->second.key) {
            gtk_widget_add_accelerator(made, "activate", accelerators, role->second.key, role->second.modifiers, GTK_ACCEL_VISIBLE);
        }
        connect(made, Action{window, "", page.role, nullptr});
    } else {
        made = page.checked ? gtk_check_menu_item_new_with_label(page.label.c_str()) : gtk_menu_item_new_with_label(page.label.c_str());
        // Setting it activates the item, so before the page hears of its clicks.
        if (page.checked) gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(made), *page.checked);
        gtk_widget_set_sensitive(made, page.isEnabled);
        connect(made, Action{window, page.id, "", clicked});
    }
    gtk_menu_shell_append(shell, made);
    if (page.accelerator) {
        const Accelerator &accelerator = *page.accelerator;
        const auto modifiers = static_cast<GdkModifierType>((accelerator.control ? GDK_CONTROL_MASK : 0) | (accelerator.alt ? GDK_MOD1_MASK : 0) |
                                                            (accelerator.shift ? GDK_SHIFT_MASK : 0));
        gtk_widget_add_accelerator(made, "activate", accelerators, keyOf(accelerator), modifiers, GTK_ACCEL_VISIBLE);
    }
}

// The page keeps the height its window gave it, so the window takes the bar's height on, unless it fills the screen.
void keepPageHeight(GtkWindow *window, GtkWidget *webView, int barHeight) {
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(window));
    if (!shown || (gdk_window_get_state(shown) & (GDK_WINDOW_STATE_MAXIMIZED | GDK_WINDOW_STATE_FULLSCREEN))) return;
    int width = 0;
    gtk_window_get_size(window, &width, nullptr);
    gtk_window_resize(window, width, gtk_widget_get_allocated_height(webView) + barHeight);
}

gboolean onPress(GtkWidget *, GdkEvent *event, gpointer) {
    if (lastPress) gdk_event_free(lastPress);
    lastPress = gdk_event_copy(event);
    lastPressTime = g_get_monotonic_time();
    return FALSE;
}

// A popup as it shows: who hears its answer, the id of the item clicked, and what goes with it.
struct Popup {
    std::function<void(Failure, std::optional<std::string>)> done;
    std::shared_ptr<std::optional<std::string>> picked;
    GtkWidget *menu;
    GtkAccelGroup *accelerators;
};

// GTK takes the menu down before an item's activate, so the answer waits for the loop's next turn.
void onPopupClosed(GtkMenuShell *menu, gpointer data) {
    g_signal_handlers_disconnect_by_func(menu, reinterpret_cast<gpointer>(onPopupClosed), data);
    g_idle_add(
        [](gpointer data) -> gboolean {
            std::unique_ptr<Popup> popup(static_cast<Popup *>(data));
            isPopupOpen = false;
            popup->done(std::nullopt, *popup->picked);
            gtk_widget_destroy(popup->menu);
            g_object_unref(popup->accelerators);
            return G_SOURCE_REMOVE;
        },
        data);
}

}  // namespace

void setDockMenu(std::vector<MenuItem>, MenuClicked, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: a macOS app alone has a Dock menu");
}

void keepPresses(void *webView) { g_signal_connect(GTK_WIDGET(webView), "button-press-event", G_CALLBACK(onPress), nullptr); }

// The menu opens at the page's point in its window's webview, which WebKitGTK zooms.
void popupMenu(uint64_t window, std::vector<MenuItem> items, double x, double y, std::function<void(Failure, std::optional<std::string>)> done) {
    onMainThread([window, items = std::move(items), x, y, done = std::move(done)] {
        const std::optional<Window> open = windowOf(window);
        GtkWidget *view = open ? GTK_WIDGET(open->webView()) : nullptr;
        if (!view || !gtk_widget_get_realized(view)) {
            done(std::string("crossbind: the app has no window to show a menu in"), std::nullopt);
            return;
        }
        if (isPopupOpen) {
            done(std::string("crossbind: a menu of the page's is open already"), std::nullopt);
            return;
        }
        auto picked = std::make_shared<std::optional<std::string>>();
        GtkWidget *menu = gtk_menu_new();
        GtkAccelGroup *accelerators = gtk_accel_group_new();
        try {
            for (const auto &item : items) {
                addItem(GTK_MENU_SHELL(menu), item, window, accelerators, [picked](uint64_t, std::string id, std::optional<bool>) { *picked = std::move(id); });
            }
        } catch (const std::exception &error) {
            gtk_widget_destroy(menu);
            g_object_unref(accelerators);
            done(std::string(error.what()), std::nullopt);
            return;
        }
        gtk_menu_attach_to_widget(GTK_MENU(menu), view, nullptr);
        auto *popup = new Popup{done, picked, menu, accelerators};
        g_signal_connect(menu, "deactivate", G_CALLBACK(onPopupClosed), popup);
        const double zoom = webkit_web_view_get_zoom_level(WEBKIT_WEB_VIEW(view));
        gtk_widget_show_all(menu);
        GdkEvent *trigger = lastPress && g_get_monotonic_time() - lastPressTime < FRESH_PRESS_US ? lastPress : nullptr;
        // The page's point in the webview's own GdkWindow: gtk_menu_popup_at_widget() takes a widget's allocation to be in
        // that window, and so added the webview's place in its toplevel once more, the menu bar's height on X11 and with
        // the client-side decorations' on Wayland.
        GdkRectangle point{static_cast<int>(x * zoom), static_cast<int>(y * zoom), 1, 1};
        gtk_menu_popup_at_rect(GTK_MENU(menu), gtk_widget_get_window(view), &point, GDK_GRAVITY_NORTH_WEST, GDK_GRAVITY_NORTH_WEST, trigger);
        // GTK shows no menu it could not grab the pointer for, and tells of none: it closes without a click.
        if (!gtk_widget_get_visible(gtk_widget_get_toplevel(menu))) {
            g_signal_handlers_disconnect_by_func(menu, reinterpret_cast<gpointer>(onPopupClosed), popup);
            delete popup;
            gtk_widget_destroy(menu);
            g_object_unref(accelerators);
            done(std::nullopt, std::nullopt);
            return;
        }
        isPopupOpen = true;
    });
}

// A Linux app is a directory: the executable, and the app's files in resources/ beside it.
std::string resourceFolder() {
    char path[PATH_MAX];
    const ssize_t length = readlink("/proc/self/exe", path, sizeof path);
    const std::string executable = length > 0 ? std::string(path, static_cast<size_t>(length)) : std::string();
    return executable.substr(0, executable.find_last_of('/')) + "/resources";
}

// The bar goes above the window's webview, in the box the host holds it in, and its accelerators come before the
// webview's keys; no menus hide it.
void setMenu(uint64_t window, std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done) {
    onMainThread([window, menus = std::move(menus), clicked = std::move(clicked), done = std::move(done)] {
        const std::optional<Window> open = windowOf(window);
        GtkWidget *view = open ? GTK_WIDGET(open->webView()) : nullptr;
        GtkWidget *box = view ? gtk_widget_get_parent(view) : nullptr;
        if (!GTK_IS_BOX(box)) {
            done("crossbind: the page's window has no place to show its menus in");
            return;
        }
        GtkWindow *shown = GTK_WINDOW(open->native());
        GtkAccelGroup *accelerators = gtk_accel_group_new();
        GtkWidget *next = gtk_menu_bar_new();
        g_object_ref_sink(next);
        try {
            for (const auto &menu : menus) addItem(GTK_MENU_SHELL(next), menu, window, accelerators, clicked);
        } catch (const std::exception &error) {
            gtk_widget_destroy(next);
            g_object_unref(next);
            g_object_unref(accelerators);
            done(std::string(error.what()));
            return;
        }
        Bar &before = bars[window];
        if (before.bar) gtk_widget_destroy(before.bar);
        if (before.accelerators) {
            gtk_window_remove_accel_group(shown, before.accelerators);
            g_object_unref(before.accelerators);
        }
        // Above the webview, which the box holds at its end.
        gtk_container_add(GTK_CONTAINER(box), next);
        int height = 0;
        if (!menus.empty()) {
            gtk_widget_show_all(next);
            gtk_widget_get_preferred_height(next, nullptr, &height);
        }
        g_object_unref(next);
        gtk_window_add_accel_group(shown, accelerators);
        before = Bar{next, accelerators};
        keepPageHeight(shown, view, height);
        done(std::nullopt);
    });
}

// The bar went with its window, which held the accelerators as well.
void dropMenus(uint64_t window) {
    const auto found = bars.find(window);
    if (found == bars.end()) return;
    if (found->second.accelerators) g_object_unref(found->second.accelerators);
    bars.erase(found);
}

}  // namespace crossbind::menu

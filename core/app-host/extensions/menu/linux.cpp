// The page's menus on Linux: a GTK menu bar above the webview.
#include "menu.h"

#include "crossbind/app.h"

#include <gtk/gtk.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <climits>
#include <map>
#include <stdexcept>

namespace crossbind::menu {
namespace {

GtkWidget *bar = nullptr;
GtkAccelGroup *barAccelerators = nullptr;
// What the bar adds to the page's height.
int menuBarHeight = 0;
MenuClicked onClick;

GtkWindow *window() { return GTK_WINDOW(appWindow()); }

GtkWidget *webView() { return static_cast<GtkWidget *>(appWebView()); }

// What a click of an item does: one of the page's tells the page its id, a standard one does what its role says.
struct Action {
    std::string id;
    std::string role;
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

void runRole(const std::string &role) {
    if (const auto command = EDITING_COMMANDS.find(role); command != EDITING_COMMANDS.end()) {
        if (webView()) webkit_web_view_execute_editing_command(WEBKIT_WEB_VIEW(webView()), command->second);
    } else if (window() && role == "minimize") {
        gtk_window_iconify(window());
    } else if (role == "quit") {
        app::requestQuit();
    } else if (window()) {
        gtk_window_close(window());
    }
}

void activated(GtkMenuItem *item, gpointer data) {
    const Action &action = *static_cast<Action *>(data);
    if (!action.role.empty()) {
        runRole(action.role);
        return;
    }
    std::optional<bool> checked;
    if (GTK_IS_CHECK_MENU_ITEM(item)) checked = gtk_check_menu_item_get_active(GTK_CHECK_MENU_ITEM(item)) != FALSE;
    if (onClick && !action.id.empty()) onClick(action.id, checked);
}

void connect(GtkWidget *item, Action action) {
    g_signal_connect_data(item, "activate", G_CALLBACK(activated), new Action(std::move(action)),
                          [](gpointer data, GClosure *) { delete static_cast<Action *>(data); }, static_cast<GConnectFlags>(0));
}

void addItem(GtkMenuShell *shell, const MenuItem &page, GtkAccelGroup *accelerators);

// Each item goes in its shell before what may throw, so the bar destroys it with itself.
void addMenu(GtkMenuShell *shell, const std::string &label, const std::vector<MenuItem> &items, GtkAccelGroup *accelerators) {
    GtkWidget *holder = gtk_menu_item_new_with_label(label.c_str());
    GtkWidget *menu = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(holder), menu);
    gtk_menu_shell_append(shell, holder);
    for (const auto &child : items) addItem(GTK_MENU_SHELL(menu), child, accelerators);
}

void addItem(GtkMenuShell *shell, const MenuItem &page, GtkAccelGroup *accelerators) {
    if (page.isSeparator) {
        gtk_menu_shell_append(shell, gtk_separator_menu_item_new());
        return;
    }
    if (page.isSubmenu) {
        addMenu(shell, page.label, page.items, accelerators);
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
        connect(made, Action{"", page.role});
    } else {
        made = page.checked ? gtk_check_menu_item_new_with_label(page.label.c_str()) : gtk_menu_item_new_with_label(page.label.c_str());
        // Setting it activates the item, so before the page hears of its clicks.
        if (page.checked) gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(made), *page.checked);
        gtk_widget_set_sensitive(made, page.isEnabled);
        connect(made, Action{page.id, ""});
    }
    gtk_menu_shell_append(shell, made);
    if (page.accelerator) {
        const Accelerator &accelerator = *page.accelerator;
        const auto modifiers = static_cast<GdkModifierType>((accelerator.control ? GDK_CONTROL_MASK : 0) | (accelerator.alt ? GDK_MOD1_MASK : 0) |
                                                            (accelerator.shift ? GDK_SHIFT_MASK : 0));
        gtk_widget_add_accelerator(made, "activate", accelerators, keyOf(accelerator), modifiers, GTK_ACCEL_VISIBLE);
    }
}

// The page keeps the height app.window gives it, so the window takes the bar's height on, unless it fills the screen.
void keepPageHeight(GtkWindow *window, int barHeight) {
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(window));
    if (!shown || (gdk_window_get_state(shown) & (GDK_WINDOW_STATE_MAXIMIZED | GDK_WINDOW_STATE_FULLSCREEN))) return;
    int width = 0;
    gtk_window_get_size(window, &width, nullptr);
    gtk_window_resize(window, width, gtk_widget_get_allocated_height(webView()) + barHeight);
}

}  // namespace

// A Linux app is a directory: the executable, and the app's files in resources/ beside it.
std::string resourceFolder() {
    char path[PATH_MAX];
    const ssize_t length = readlink("/proc/self/exe", path, sizeof path);
    const std::string executable = length > 0 ? std::string(path, static_cast<size_t>(length)) : std::string();
    return executable.substr(0, executable.find_last_of('/')) + "/resources";
}

// The bar goes above the webview, in the box the host holds it in, and its accelerators come before the webview's keys;
// no menus hide it.
void setMenu(std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done) {
    onMainThread([menus = std::move(menus), clicked = std::move(clicked), done = std::move(done)] {
        GtkWidget *view = webView();
        GtkWidget *box = view ? gtk_widget_get_parent(view) : nullptr;
        if (!window() || !GTK_IS_BOX(box)) {
            done("crossbind: the app has no window to show its menus in");
            return;
        }
        GtkAccelGroup *accelerators = gtk_accel_group_new();
        GtkWidget *next = gtk_menu_bar_new();
        g_object_ref_sink(next);
        try {
            for (const auto &menu : menus) addItem(GTK_MENU_SHELL(next), menu, accelerators);
        } catch (const std::exception &error) {
            gtk_widget_destroy(next);
            g_object_unref(next);
            g_object_unref(accelerators);
            done(std::string(error.what()));
            return;
        }
        if (bar) gtk_widget_destroy(bar);
        if (barAccelerators) {
            gtk_window_remove_accel_group(window(), barAccelerators);
            g_object_unref(barAccelerators);
        }
        // Above the webview, which the box holds at its end.
        gtk_container_add(GTK_CONTAINER(box), next);
        menuBarHeight = 0;
        if (!menus.empty()) {
            gtk_widget_show_all(next);
            gtk_widget_get_preferred_height(next, nullptr, &menuBarHeight);
        }
        g_object_unref(next);
        gtk_window_add_accel_group(window(), accelerators);
        bar = next;
        barAccelerators = accelerators;
        onClick = clicked;
        keepPageHeight(window(), menuBarHeight);
        done(std::nullopt);
    });
}

}  // namespace crossbind::menu

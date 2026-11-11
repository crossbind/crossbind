// A Linux app's windows: GtkWindows the host makes, each with a vertical box that holds the WebKitWebView the webview
// library makes, below the widgets an extension adds, as the page's menu bar, and which keeps the page to its window's
// limits. A Wayland compositor places a window and keeps it among the others itself.
#include "desktop.h"
#include "main_thread.h"

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

#include <climits>
#include <stdexcept>
#include <string>

namespace app = crossbind::app;

namespace {

// What a window keeps of its options and of the page: the limits the page grows to, and the press of the primary button
// on the page while it is down, which a window's move starts from.
struct LinuxWindow {
    uint64_t id = 0;
    GtkWindow *window = nullptr;
    GtkBox *box = nullptr;
    GtkWidget *webView = nullptr;
    bool isResizable = true;
    int maxWidth = 0;
    int maxHeight = 0;
    guint pressButton = 0;
    gint pressX = 0;
    gint pressY = 0;
    guint32 pressTime = 0;
};

constexpr const char *STATE = "crossbind-window";

LinuxWindow &windowState(void *window) { return *static_cast<LinuxWindow *>(g_object_get_data(G_OBJECT(window), STATE)); }

bool isWayland() { return std::string(G_OBJECT_TYPE_NAME(gdk_display_get_default())) == "GdkWaylandDisplay"; }

// What the widgets an extension shows above the page add to its height, as the menu extension's bar.
int heightAbove(const LinuxWindow &state) {
    int height = 0;
    GList *children = gtk_container_get_children(GTK_CONTAINER(state.box));
    for (GList *child = children; child; child = child->next) {
        GtkWidget *widget = GTK_WIDGET(child->data);
        if (widget == state.webView || !gtk_widget_get_visible(widget)) continue;
        int natural = 0;
        gtk_widget_get_preferred_height(widget, nullptr, &natural);
        height += natural;
    }
    g_list_free(children);
    return height;
}

bool fillsScreen(const LinuxWindow &state) {
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(state.window));
    return shown && (gdk_window_get_state(shown) & GDK_WINDOW_STATE_FULLSCREEN);
}

// Holds the window to its limits, its fixed size or the most the page grows to with what shows above it, but for while
// it fills the screen, which a window manager would hold to them as well.
void keepSizeLimits(LinuxWindow &state) {
    const bool isFilling = fillsScreen(state);
    gtk_window_set_resizable(state.window, isFilling || state.isResizable);
    if (state.maxWidth <= 0 && state.maxHeight <= 0) {
        gtk_window_set_geometry_hints(state.window, nullptr, nullptr, static_cast<GdkWindowHints>(0));
        return;
    }
    GdkGeometry most{};
    most.max_width = state.maxWidth > 0 ? state.maxWidth : SHRT_MAX;
    most.max_height = (state.maxHeight > 0 ? state.maxHeight : SHRT_MAX) + heightAbove(state);
    gtk_window_set_geometry_hints(state.window, nullptr, &most, isFilling ? static_cast<GdkWindowHints>(0) : GDK_HINT_MAX_SIZE);
}

void limitsChanged(gpointer data) { keepSizeLimits(*static_cast<LinuxWindow *>(data)); }

// An extension's widget goes above the page at its own height, which holds the window to the limits as it shows and
// goes; the page takes the rest.
void childAdded(GtkContainer *box, GtkWidget *child, gpointer data) {
    gtk_box_set_child_packing(GTK_BOX(box), child, FALSE, FALSE, 0, GTK_PACK_START);
    g_signal_connect_swapped(child, "notify::visible", G_CALLBACK(limitsChanged), data);
    limitsChanged(data);
}

void childRemoved(GtkContainer *box, GtkWidget *, gpointer data) {
    if (!gtk_widget_in_destruction(GTK_WIDGET(box))) limitsChanged(data);
}

// The app is active while one of its windows has the focus. A Linux desktop tells of each window's, the one that loses
// it first, so the host reads them once both have told.
bool isActiveReadPending = false;

void readActive() {
    if (isActiveReadPending) return;
    isActiveReadPending = true;
    g_idle_add(+[](gpointer) -> gboolean {
        isActiveReadPending = false;
        bool isActive = false;
        for (const crossbind::Window &open : crossbind::openWindows()) isActive = isActive || gtk_window_is_active(GTK_WINDOW(open.native()));
        app::appActivated(isActive);
        return G_SOURCE_REMOVE;
    }, nullptr);
}

void focusChanged(GObject *window, GParamSpec *, gpointer data) {
    if (gtk_window_is_active(GTK_WINDOW(window))) app::windowFocused(static_cast<LinuxWindow *>(data)->id);
    readActive();
}

// The middle of the monitor the window is on, or the main one's.
void center(GtkWindow *window) {
    GdkDisplay *display = gdk_display_get_default();
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(window));
    GdkMonitor *monitor = shown ? gdk_display_get_monitor_at_window(display, shown) : gdk_display_get_primary_monitor(display);
    if (!monitor) monitor = gdk_display_get_monitor(display, 0);
    if (!monitor) return;
    GdkRectangle area{};
    gdk_monitor_get_workarea(monitor, &area);
    int width = 0;
    int height = 0;
    gtk_window_get_size(window, &width, &height);
    gtk_window_move(window, area.x + (area.width - width) / 2, area.y + (area.height - height) / 2);
}

}  // namespace

void startWindows() {
    if (!gtk_init_check(nullptr, nullptr)) throw std::runtime_error("crossbind: GTK found no display to open the app's window on");
}

void *makeWindow(const app::WindowOptions &options, void *parent, std::vector<std::string> &ignored) {
    GtkWindow *window = GTK_WINDOW(gtk_window_new(GTK_WINDOW_TOPLEVEL));
    auto *state = new LinuxWindow;
    state->window = window;
    state->isResizable = options.resizable;
    state->maxWidth = options.maxWidth;
    state->maxHeight = options.maxHeight;
    g_object_set_data_full(G_OBJECT(window), STATE, state, [](gpointer data) { delete static_cast<LinuxWindow *>(data); });
    gtk_window_set_title(window, options.title.c_str());
    gtk_window_set_default_size(window, options.width, options.height);
    gtk_window_set_resizable(window, options.resizable);
    if (!options.frame) gtk_window_set_decorated(window, FALSE);
    // A page under the title bar's buttons is macOS's alone; GTK keeps the title bar it draws.
    if (options.titleBarHidden) ignored.emplace_back("titleBar");
    // Each window is a group of its own, so a modal window holds its parent's group alone.
    if (parent && options.modal) {
        gtk_window_group_add_window(gtk_window_get_group(GTK_WINDOW(parent)), window);
    } else {
        GtkWindowGroup *group = gtk_window_group_new();
        gtk_window_group_add_window(group, window);
        g_object_unref(group);
    }
    if (parent) {
        gtk_window_set_transient_for(window, GTK_WINDOW(parent));
        gtk_window_set_modal(window, options.modal);
    }
    const bool isPlacedByCompositor = isWayland();
    if (options.alwaysOnTop) {
        if (isPlacedByCompositor) ignored.emplace_back("alwaysOnTop");
        else gtk_window_set_keep_above(window, TRUE);
    }
    if (options.x && isPlacedByCompositor) ignored.insert(ignored.end(), {"x", "y"});
    else if (options.x) gtk_window_move(window, *options.x, *options.y);
    else gtk_window_set_position(window, parent && options.modal ? GTK_WIN_POS_CENTER_ON_PARENT : GTK_WIN_POS_CENTER);
    const std::string icon = resourceDir() + "/icon.png";
    if (g_file_test(icon.c_str(), G_FILE_TEST_EXISTS)) gtk_window_set_icon_from_file(window, icon.c_str(), nullptr);
    return window;
}

// The webview goes in a box, above which an extension shows its widgets, as the page's menu bar, and takes the window's
// minimum size, which is the page's. GTK holds a window that does not resize to the size of what it holds, so the
// webview asks for the page's.
void readyWindow(void *native, void *webView, uint64_t id, const app::WindowOptions &options, void *, std::vector<std::string> &) {
    LinuxWindow &state = windowState(native);
    state.id = id;
    state.webView = GTK_WIDGET(webView);
    if (!options.resizable) gtk_widget_set_size_request(state.webView, options.width, options.height);
    else if (options.minWidth > 0 || options.minHeight > 0) gtk_widget_set_size_request(state.webView, options.minWidth, options.minHeight);
    state.box = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0));
    gtk_box_pack_end(state.box, state.webView, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(state.window), GTK_WIDGET(state.box));
    gtk_widget_show(state.webView);
    gtk_widget_show(GTK_WIDGET(state.box));
    g_signal_connect(state.box, "add", G_CALLBACK(childAdded), &state);
    g_signal_connect(state.box, "remove", G_CALLBACK(childRemoved), &state);
    // The window asks the app's extensions as its user closes it, and the host closes it: TRUE keeps GTK from it.
    g_signal_connect(state.window, "delete-event", G_CALLBACK(+[](GtkWidget *, GdkEvent *, gpointer data) -> gboolean {
        app::closeAsked(static_cast<LinuxWindow *>(data)->id);
        return TRUE;
    }), &state);
    g_signal_connect(state.window, "notify::is-active", G_CALLBACK(focusChanged), &state);
    g_signal_connect(state.window, "window-state-event", G_CALLBACK(+[](GtkWidget *, GdkEventWindowState *event, gpointer data) -> gboolean {
        if (event->changed_mask & GDK_WINDOW_STATE_FULLSCREEN) limitsChanged(data);
        return FALSE;
    }), &state);
    // The press of the primary button, which the page's startDrag() moves the window from, on Wayland as well, until
    // its release.
    g_signal_connect(state.webView, "button-press-event", G_CALLBACK(+[](GtkWidget *, GdkEventButton *event, gpointer data) -> gboolean {
        if (event->button == GDK_BUTTON_PRIMARY && event->type == GDK_BUTTON_PRESS) {
            auto &pressed = *static_cast<LinuxWindow *>(data);
            pressed.pressButton = event->button;
            pressed.pressX = static_cast<gint>(event->x_root);
            pressed.pressY = static_cast<gint>(event->y_root);
            pressed.pressTime = event->time;
        }
        return FALSE;
    }), &state);
    g_signal_connect(state.webView, "button-release-event", G_CALLBACK(+[](GtkWidget *, GdkEventButton *event, gpointer data) -> gboolean {
        if (event->button == GDK_BUTTON_PRIMARY) static_cast<LinuxWindow *>(data)->pressButton = 0;
        return FALSE;
    }), &state);
    keepSizeLimits(state);
}

void presentWindow(void *native, void *webView, const app::WindowOptions &options, void *) {
    GtkWindow *window = GTK_WINDOW(native);
    gtk_widget_show(GTK_WIDGET(window));
    gtk_widget_grab_focus(GTK_WIDGET(webView));
    if (options.fullscreen) gtk_window_fullscreen(window);
    gtk_window_present(window);
}

void changeWindow(void *native, void *, const app::WindowChanges &changes, std::vector<std::string> &ignored) {
    LinuxWindow &state = windowState(native);
    GtkWindow *window = state.window;
    if (changes.title) gtk_window_set_title(window, changes.title->c_str());
    if (changes.resizable) state.isResizable = *changes.resizable;
    if (changes.maxWidth) state.maxWidth = *changes.maxWidth;
    if (changes.maxHeight) state.maxHeight = *changes.maxHeight;
    if (changes.minWidth || changes.minHeight) {
        int width = -1;
        int height = -1;
        gtk_widget_get_size_request(state.webView, &width, &height);
        gtk_widget_set_size_request(state.webView, changes.minWidth.value_or(width), changes.minHeight.value_or(height));
    }
    if (changes.width || changes.height) {
        int width = 0;
        int height = 0;
        gtk_window_get_size(window, &width, &height);
        gtk_window_resize(window, changes.width.value_or(width), changes.height ? *changes.height + heightAbove(state) : height);
    }
    keepSizeLimits(state);
    if (isWayland()) {
        if (changes.x) ignored.insert(ignored.end(), {"x", "y"});
        if (changes.center) ignored.emplace_back("center");
        if (changes.alwaysOnTop) ignored.emplace_back("alwaysOnTop");
    } else {
        if (changes.x) gtk_window_move(window, *changes.x, *changes.y);
        else if (changes.center) center(window);
        if (changes.alwaysOnTop) gtk_window_set_keep_above(window, *changes.alwaysOnTop);
    }
    if (changes.fullscreen && *changes.fullscreen != fillsScreen(state)) {
        if (*changes.fullscreen) gtk_window_fullscreen(window);
        else gtk_window_unfullscreen(window);
    }
}

app::WindowState stateOfWindow(void *native, void *) {
    LinuxWindow &state = windowState(native);
    app::WindowState told;
    const char *title = gtk_window_get_title(state.window);
    told.title = title ? title : "";
    gtk_window_get_position(state.window, &told.x, &told.y);
    gtk_window_get_size(state.window, &told.width, &told.height);
    told.height -= heightAbove(state);
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(state.window));
    const GdkWindowState flags = shown ? gdk_window_get_state(shown) : static_cast<GdkWindowState>(0);
    told.isMaximized = gtk_window_is_maximized(state.window) != FALSE;
    told.isMinimized = (flags & GDK_WINDOW_STATE_ICONIFIED) != 0;
    told.isFullscreen = (flags & GDK_WINDOW_STATE_FULLSCREEN) != 0;
    told.isFocused = gtk_window_is_active(state.window) != FALSE;
    return told;
}

void focusWindow(void *native) { gtk_window_present(GTK_WINDOW(native)); }

void minimizeWindow(void *native) { gtk_window_iconify(GTK_WINDOW(native)); }

void toggleMaximizeWindow(void *native) {
    GtkWindow *window = GTK_WINDOW(native);
    if (gtk_window_is_maximized(window)) gtk_window_unmaximize(window);
    else gtk_window_maximize(window);
}

// A move starts from the press of the primary button on the page while it is down.
void dragWindow(void *native) {
    const LinuxWindow &state = windowState(native);
    if (state.pressButton == 0) return;
    gtk_window_begin_move_drag(state.window, static_cast<gint>(state.pressButton), state.pressX, state.pressY, state.pressTime);
}

// The library takes its webview from the box, which goes with the window.
void destroyWindow(void *native, void *, bool, const std::function<void()> &letGo) {
    letGo();
    gtk_widget_destroy(GTK_WIDGET(native));
}

// The extensions hear how the app is once its first window has shown, which may not have taken the focus.
void runLoop() {
    readActive();
    gtk_main();
}

void endLoop() { gtk_main_quit(); }

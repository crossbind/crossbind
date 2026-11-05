#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "linux/main_thread.h"
#include "platform.h"

#include <gtk/gtk.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <cerrno>
#include <cstdlib>
#include <stdexcept>

namespace {

GtkWindow *mainWindow = nullptr;
GtkBox *windowBox = nullptr;
GtkWidget *webView = nullptr;

// An XDG base directory: the variable's absolute path, else the default under the home folder.
std::string baseDirectory(const char *variable, const char *underHome) {
    const char *set = std::getenv(variable);
    if (set && *set == '/') return set;
    return std::string(g_get_home_dir()) + underHome;
}

std::string made(const std::string &path) {
    if (g_mkdir_with_parents(path.c_str(), 0700) != 0) {
        throw std::runtime_error("crossbind: cannot make the app's folder " + path + ": " + g_strerror(errno));
    }
    return path;
}

#ifdef CROSSBIND_APP_WINDOW_MAX_WIDTH
// What the widgets an extension shows above the page add to its height, as the menu extension's bar.
int heightAbove() {
    int height = 0;
    GList *children = gtk_container_get_children(GTK_CONTAINER(windowBox));
    for (GList *child = children; child; child = child->next) {
        GtkWidget *widget = GTK_WIDGET(child->data);
        if (widget == webView || !gtk_widget_get_visible(widget)) continue;
        int natural = 0;
        gtk_widget_get_preferred_height(widget, nullptr, &natural);
        height += natural;
    }
    g_list_free(children);
    return height;
}
#endif

// Holds the window to app.window's limits, its fixed size or the most the page grows to with what shows above it, but
// for while it fills the screen, which a window manager would hold to them as well.
void keepSizeLimits() {
    if (!mainWindow) return;
    GdkWindow *shown = gtk_widget_get_window(GTK_WIDGET(mainWindow));
    const bool fillsScreen = shown && (gdk_window_get_state(shown) & GDK_WINDOW_STATE_FULLSCREEN);
    gtk_window_set_resizable(mainWindow, fillsScreen || CROSSBIND_APP_WINDOW_RESIZABLE);
#ifdef CROSSBIND_APP_WINDOW_MAX_WIDTH
    GdkGeometry most{};
    most.max_width = CROSSBIND_APP_WINDOW_MAX_WIDTH;
    most.max_height = CROSSBIND_APP_WINDOW_MAX_HEIGHT + (windowBox ? heightAbove() : 0);
    gtk_window_set_geometry_hints(mainWindow, nullptr, &most, fillsScreen ? static_cast<GdkWindowHints>(0) : GDK_HINT_MAX_SIZE);
#endif
}

void sizeLimitsChanged(GObject *, GParamSpec *, gpointer) { keepSizeLimits(); }

// An extension's widget goes above the page at its own height, which holds the window to the limits as it shows and
// goes; the page takes the rest.
void childAdded(GtkContainer *box, GtkWidget *child, gpointer) {
    gtk_box_set_child_packing(GTK_BOX(box), child, FALSE, FALSE, 0, GTK_PACK_START);
    g_signal_connect(child, "notify::visible", G_CALLBACK(sizeLimitsChanged), nullptr);
    keepSizeLimits();
}

void childRemoved(GtkContainer *box, GtkWidget *, gpointer) {
    if (!gtk_widget_in_destruction(GTK_WIDGET(box))) keepSizeLimits();
}

}  // namespace

crossbind::app::Paths appPaths() {
    const std::string id = CROSSBIND_APP_ID;
    return {made(baseDirectory("XDG_DATA_HOME", "/.local/share") + "/" + id), made(baseDirectory("XDG_CACHE_HOME", "/.cache") + "/" + id),
            made(baseDirectory("XDG_STATE_HOME", "/.local/state") + "/" + id + "/logs")};
}

void crossbind::onMainThread(std::function<void()> fn) { ::onMainThread(std::move(fn)); }

// The process's first thread runs GTK; the image's glibc predates gettid().
bool isMainThread() { return syscall(SYS_gettid) == getpid(); }

// The window goes without asking the app's extensions, as its user's closing it does.
void quitApp() {
    onMainThread([] {
        if (mainWindow) gtk_widget_destroy(GTK_WIDGET(mainWindow));
    });
}

// Forgotten when they go, so a late call finds none. It shows the app's icon, if the app has one. Before the page
// loads, the webview, which webview put in the window, goes in a box, above which an extension shows its widgets, as the
// page's menu bar, and takes the window's minimum size, which is the page's. GTK holds a window that does not resize to
// the size of what it holds, whatever size webview asked for, so the webview asks for the page's.
void setMainWindow(void *window, void *view) {
    mainWindow = GTK_WINDOW(window);
    g_object_add_weak_pointer(G_OBJECT(mainWindow), reinterpret_cast<gpointer *>(&mainWindow));
    // The window asks the app's extensions as its user closes it: TRUE keeps it.
    g_signal_connect(mainWindow, "delete-event", G_CALLBACK(+[](GtkWidget *, GdkEvent *, gpointer) -> gboolean { return !crossbind::app::isCloseAllowed(); }), nullptr);
    // A Linux desktop tells of the app's window alone: the app is active while its window has the focus, which it may
    // have taken as it showed, so the extensions hear how it is once the window has opened.
    g_signal_connect(mainWindow, "notify::is-active", G_CALLBACK(+[](GObject *window, GParamSpec *, gpointer) {
        crossbind::app::appActivated(gtk_window_is_active(GTK_WINDOW(window)) != FALSE);
    }), nullptr);
    onMainThread([] {
        if (mainWindow) crossbind::app::appActivated(gtk_window_is_active(mainWindow) != FALSE);
    });
    const std::string icon = resourceDir() + "/icon.png";
    if (g_file_test(icon.c_str(), G_FILE_TEST_EXISTS)) gtk_window_set_icon_from_file(mainWindow, icon.c_str(), nullptr);
    webView = static_cast<GtkWidget *>(view);
    if (!webView) return;
    g_object_add_weak_pointer(G_OBJECT(webView), reinterpret_cast<gpointer *>(&webView));
    int minWidth = -1;
    int minHeight = -1;
    gtk_widget_get_size_request(GTK_WIDGET(mainWindow), &minWidth, &minHeight);
    gtk_widget_set_size_request(GTK_WIDGET(mainWindow), -1, -1);
    if (!gtk_window_get_resizable(mainWindow)) {
        minWidth = CROSSBIND_APP_WINDOW_WIDTH;
        minHeight = CROSSBIND_APP_WINDOW_HEIGHT;
    }
    gtk_widget_set_size_request(webView, minWidth, minHeight);
    g_object_ref(webView);
    gtk_container_remove(GTK_CONTAINER(mainWindow), webView);
    windowBox = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0));
    g_object_add_weak_pointer(G_OBJECT(windowBox), reinterpret_cast<gpointer *>(&windowBox));
    gtk_box_pack_end(windowBox, webView, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(mainWindow), GTK_WIDGET(windowBox));
    g_object_unref(webView);
    gtk_widget_show(GTK_WIDGET(windowBox));
    gtk_widget_grab_focus(webView);
    g_signal_connect(windowBox, "add", G_CALLBACK(childAdded), nullptr);
    g_signal_connect(windowBox, "remove", G_CALLBACK(childRemoved), nullptr);
    g_signal_connect(mainWindow, "window-state-event", G_CALLBACK(+[](GtkWidget *, GdkEventWindowState *event, gpointer) -> gboolean {
                         if (event->changed_mask & GDK_WINDOW_STATE_FULLSCREEN) keepSizeLimits();
                         return FALSE;
                     }),
                     nullptr);
}

void setBackgroundColor(void *, void *view, std::uint32_t color) {
    const GdkRGBA rgba{((color >> 16) & 0xff) / 255.0, ((color >> 8) & 0xff) / 255.0, (color & 0xff) / 255.0, 1};
    webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(view), &rgba);
}

void fillScreen() {
    if (mainWindow) gtk_window_fullscreen(mainWindow);
}

void showWindow(const std::string &token) {
    onMainThread([token] {
        if (!mainWindow) return;
        if (!token.empty()) gtk_window_set_startup_id(mainWindow, token.c_str());
        gtk_window_present(mainWindow);
    });
}

void *crossbind::appWindow() { return mainWindow; }

void *crossbind::appWebView() { return webView; }

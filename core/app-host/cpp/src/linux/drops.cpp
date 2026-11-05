#include "page_requests.h"
#include "platform.h"

#include <webkit2/webkit2.h>

#include <algorithm>

namespace app = crossbind::app;

// WebKitGTK asks for a drag's data as it moves over the page, so the files a drop carries are those its drag brought
// last; page-drops hears of them as the drop goes on to WebKitGTK.
namespace {

struct Drops {
    std::vector<std::string> origins;
    // The drag whose files came last, which the host holds while it may drop them.
    GdkDragContext *drag = nullptr;
    std::vector<std::string> paths;
};

std::string originOf(const char *uri) {
    const std::string text = uri ? uri : "";
    const auto scheme = text.find("://");
    if (scheme == std::string::npos) return "";
    return text.substr(0, text.find_first_of("/?#", scheme + 3));
}

void forget(Drops &drops) {
    if (drops.drag) g_object_unref(drops.drag);
    drops.drag = nullptr;
    drops.paths.clear();
}

void onDragData(GtkWidget *, GdkDragContext *drag, gint, gint, GtkSelectionData *data, guint, guint, gpointer state) {
    gchar **uris = gtk_selection_data_get_uris(data);
    if (!uris) return;
    auto &drops = *static_cast<Drops *>(state);
    forget(drops);
    for (gchar **uri = uris; *uri; ++uri) {
        gchar *path = g_filename_from_uri(*uri, nullptr, nullptr);
        if (path) drops.paths.emplace_back(path);
        g_free(path);
    }
    g_strfreev(uris);
    drops.drag = GDK_DRAG_CONTEXT(g_object_ref(drag));
}

// FALSE lets WebKitGTK take the drop as well.
gboolean onDragDrop(GtkWidget *widget, GdkDragContext *drag, gint x, gint y, guint, gpointer state) {
    auto &drops = *static_cast<Drops *>(state);
    WebKitWebView *view = WEBKIT_WEB_VIEW(widget);
    const bool isOwn = std::find(drops.origins.begin(), drops.origins.end(), originOf(webkit_web_view_get_uri(view))) != drops.origins.end();
    // The owner may run a dialog's loop, in which the next drag's data comes.
    const std::vector<std::string> paths = drops.drag == drag && isOwn ? drops.paths : std::vector<std::string>();
    forget(drops);
    if (!paths.empty()) {
        const double zoom = webkit_web_view_get_zoom_level(view);
        app::droppedFiles(paths, x / zoom, y / zoom);
    }
    return FALSE;
}

}  // namespace

void takeDrops(void *webView, std::vector<std::string> origins) {
    auto *drops = new Drops{std::move(origins)};
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "drag-data-received", G_CALLBACK(onDragData), drops);
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "drag-drop", G_CALLBACK(onDragDrop), drops);
}

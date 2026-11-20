// What the probe adds on Linux: a close of the window, as its user's, and zstd's version, from a library beyond
// crossbind's sysroot, whose pinned packages its descriptor lists.
#include "probe.h"

#include <gtk/gtk.h>
#include <zstd.h>

// The dialog's own loop runs what the main loop is given while it waits for its answer.
void closeMessageDialog(const std::string &message, std::function<void(bool)> done) {
    crossbind::onMainThread([message, done] {
        bool isShown = false;
        GList *windows = gtk_window_list_toplevels();
        for (GList *item = windows; item && !isShown; item = item->next) {
            if (!GTK_IS_MESSAGE_DIALOG(item->data)) continue;
            gchar *text = nullptr;
            g_object_get(item->data, "text", &text, nullptr);
            isShown = text && message == text;
            if (isShown) gtk_dialog_response(GTK_DIALOG(item->data), GTK_RESPONSE_DELETE_EVENT);
            g_free(text);
        }
        g_list_free(windows);
        done(isShown);
    });
}

void probePlatform(crossbind::Registry &registry) {
    registry.function("probe.close", [](crossbind::Call call) {
        crossbind::onMainThread([call] {
            gtk_window_close(GTK_WINDOW(crossbind::appWindow()));
            call.resolve();
        });
    });
    registry.function("probe.zstd", [](crossbind::Call call) { call.resolve(static_cast<int>(ZSTD_versionNumber())); });
}

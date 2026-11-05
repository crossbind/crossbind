// What the probe adds on Linux: a close of the window, as its user's, and zstd's version, from a library beyond
// crossbind's sysroot, whose pinned packages its descriptor lists.
#include "probe.h"

#include <gtk/gtk.h>
#include <zstd.h>

void probePlatform(crossbind::Registry &registry) {
    registry.function("probe.close", [](crossbind::Call call) {
        crossbind::onMainThread([call] {
            gtk_window_close(GTK_WINDOW(crossbind::appWindow()));
            call.resolve();
        });
    });
    registry.function("probe.zstd", [](crossbind::Call call) { call.resolve(static_cast<int>(ZSTD_versionNumber())); });
}

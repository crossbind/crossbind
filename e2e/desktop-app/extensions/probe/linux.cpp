// What the probe adds on Linux: a close of the window, as its user's.
#include "probe.h"

#include <gtk/gtk.h>

void probePlatform(crossbind::Registry &registry) {
    registry.function("probe.close", [](crossbind::Call call) {
        crossbind::onMainThread([call] {
            gtk_window_close(GTK_WINDOW(crossbind::appWindow()));
            call.resolve();
        });
    });
}

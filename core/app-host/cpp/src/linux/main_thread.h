#pragma once

#include "platform.h"

#include <glib.h>

#include <functional>

// Runs fn on the GTK main loop as soon as the loop gets to it, after what waits there already, also when the caller is
// the loop's own thread; the loop never sees what fn throws. g_main_context_invoke would run it on any thread that finds
// the loop between two iterations.
inline void onMainThread(std::function<void()> fn) {
    g_idle_add_full(
        G_PRIORITY_DEFAULT,
        [](gpointer data) -> gboolean {
            runTask(*static_cast<std::function<void()> *>(data));
            return G_SOURCE_REMOVE;
        },
        new std::function<void()>(std::move(fn)), [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
}

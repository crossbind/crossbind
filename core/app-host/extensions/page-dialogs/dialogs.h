#pragma once

#include "crossbind/extension.h"

// The page's dialog in the platform's own, titled with the app's name, over the page's window; the page waits for its
// answer.
void showPageDialog(crossbind::PageDialog dialog);

// The platform's window of the page that asks, on the main thread: the app's oldest for a page whose window went.
inline void *windowOf(const crossbind::PageDialog &dialog) {
    const std::optional<crossbind::Window> open = crossbind::windowOf(dialog.page().windowId());
    return open ? open->native() : crossbind::appWindow();
}

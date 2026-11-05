#pragma once

// What each desktop platform does to tell the page when the system goes to sleep and when it wakes, as the events suspend
// and resume.
#include "crossbind/extension.h"

namespace crossbind::power {

// Starts hearing of them, on the main thread once the app's first window has opened.
void listen();

#ifdef _WIN32
// The window that hears of them for the app closed, on the main thread: the oldest left hears of them from now on.
void windowClosed(void *window);
#endif

}  // namespace crossbind::power

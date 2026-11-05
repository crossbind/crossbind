#pragma once

// What each desktop platform does to tell the page when the system goes to sleep and when it wakes, as the events suspend
// and resume.
#include "crossbind/extension.h"

namespace crossbind::power {

// Starts hearing of them, on the main thread once the app's window has opened.
void listen();

}  // namespace crossbind::power

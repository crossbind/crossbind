// The system's sleep and waking, which a desktop app's page hears of as the events suspend and resume: each platform
// hears of them its own way, from the time the app's window opens.
#include "power.h"

void crossbind_extension_power(crossbind::Registry &registry) {
    registry.onWindow([](const crossbind::Window &) { crossbind::power::listen(); });
}

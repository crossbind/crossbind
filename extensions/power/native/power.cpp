// The system's sleep and waking, which a desktop app's pages hear of as the events suspend and resume: each platform
// hears of them its own way, once, from the time the app's first window opens.
#include "power.h"

#include <utility>

void crossbind_extension_power(crossbind::Registry &registry) {
    registry.onWindow([](const crossbind::Window &) {
        static bool isListening = false;
        if (!std::exchange(isListening, true)) crossbind::power::listen();
    });
#ifdef _WIN32
    registry.onWindowClosed([](const crossbind::Window &window) { crossbind::power::windowClosed(window.native()); });
#endif
}

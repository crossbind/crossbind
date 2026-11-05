// What the probe adds on Windows: a close of the window, as its user's, which the window takes before it answers.
#include "probe.h"

#include <windows.h>

void probePlatform(crossbind::Registry &registry) {
    registry.function("probe.close", [](crossbind::Call call) {
        crossbind::onMainThread([call] {
            SendMessageW(static_cast<HWND>(crossbind::appWindow()), WM_CLOSE, 0, 0);
            call.resolve();
        });
    });
}

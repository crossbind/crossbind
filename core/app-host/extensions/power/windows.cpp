#include "power.h"

#include "crossbind/app.h"

#include <windows.h>

#include <commctrl.h>

#include <cstdio>

namespace crossbind::power {
namespace {

constexpr UINT_PTR SUBCLASS = 1;

// Windows tells the app's windows the system goes to sleep and wakes; one with Modern Standby may tell neither.
LRESULT CALLBACK powerProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) {
    if (message == WM_POWERBROADCAST && (wParam == PBT_APMSUSPEND || wParam == PBT_APMRESUMEAUTOMATIC)) {
        crossbind::app::emitEvent(wParam == PBT_APMSUSPEND ? "suspend" : "resume");
    }
    return DefSubclassProc(hwnd, message, wParam, lParam);
}

// The one window that hears of them, as each of the app's would.
HWND listener = nullptr;

void listenOn(HWND window) {
    listener = nullptr;
    if (!window) return;
    if (!SetWindowSubclass(window, powerProcedure, SUBCLASS, 0)) {
        std::fprintf(stderr, "crossbind: the app cannot hear of the system's sleep: Windows error %lu\n", GetLastError());
        return;
    }
    listener = window;
}

}  // namespace

void listen() { listenOn(static_cast<HWND>(appWindow())); }

void windowClosed(void *window) {
    if (window == listener) listenOn(static_cast<HWND>(appWindow()));
}

}  // namespace crossbind::power

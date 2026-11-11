// A Windows app's windows: each one the webview library makes, which holds its webview to the window's scale, with the
// host's procedure before the library's, which tells the host of its close, its front and the session's end, holds it
// to its limits and fills the screen for it.
#include "desktop.h"
#include "webview/webview.h"
#include "windows/com.h"

#include <algorithm>
#include <map>

namespace app = crossbind::app;
using namespace crossbind::windows;

namespace {

constexpr int MAX_SIZE = 16384;

// What the host keeps of a window: its id, the procedure before the host's, its limits, its frame and place before it
// filled the screen, to which it goes back, and whether it opened full screen, to which it goes back once the page's
// element leaves the screen.
struct Win32Window {
    uint64_t id = 0;
    WNDPROC procedure = nullptr;
    int minWidth = 0;
    int minHeight = 0;
    int maxWidth = 0;
    int maxHeight = 0;
    LONG_PTR windowedStyle = 0;
    WINDOWPLACEMENT windowedPlace{};
    bool isFullScreen = false;
    bool opensFullScreen = false;
};

std::map<HWND, Win32Window> made;
// The modal windows open over each window, which takes no input until the last of them closes.
std::map<HWND, int> modalsOver;
std::function<void()> quitWithSession;

int dpiOf(HWND window) { return webview::detail::get_window_dpi(window); }

int physical(int logical, HWND window) { return MulDiv(logical, dpiOf(window), webview::detail::get_default_window_dpi()); }

int logical(int physical, HWND window) { return MulDiv(physical, webview::detail::get_default_window_dpi(), dpiOf(window)); }

// A page's size as the window's frame holds it at the window's scale, with its menu bar.
SIZE frameOf(HWND window, int width, int height) {
    namespace dpi = webview::detail;
    const int scale = dpiOf(window);
    const SIZE page = dpi::scale_size(width, height, dpi::get_default_window_dpi(), scale);
    return dpi::make_window_frame_size(window, page.cx, page.cy, scale);
}

// The whole of the screen a window is on, or the part the taskbar leaves.
std::optional<RECT> screenOf(HWND window, bool isWorkArea) {
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    if (!GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor)) return std::nullopt;
    return isWorkArea ? monitor.rcWork : monitor.rcMonitor;
}

void cover(HWND window, const RECT &screen, UINT flags) {
    SetWindowPos(window, HWND_TOP, screen.left, screen.top, screen.right - screen.left, screen.bottom - screen.top, flags);
}

// The middle of the work area of the monitor of a window, or of the one over it.
void center(HWND window, HWND over) {
    const std::optional<RECT> area = screenOf(over ? over : window, true);
    RECT frame{};
    if (!area || !GetWindowRect(window, &frame)) return;
    const LONG width = frame.right - frame.left;
    const LONG height = frame.bottom - frame.top;
    SetWindowPos(window, nullptr, area->left + std::max(0L, (area->right - area->left - width) / 2), area->top + std::max(0L, (area->bottom - area->top - height) / 2),
        0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

// A window that fills the screen is a popup without a frame, whose size Windows does not hold to its limits.
void setFullScreen(HWND window, bool isFull) {
    const auto found = made.find(window);
    if (found == made.end() || isFull == found->second.isFullScreen) return;
    Win32Window &state = found->second;
    if (isFull) {
        state.windowedPlace.length = sizeof(state.windowedPlace);
        const std::optional<RECT> screen = screenOf(window, false);
        if (!GetWindowPlacement(window, &state.windowedPlace) || !screen) return;
        // Windows keeps the taskbar over a maximized window; the placement maximizes it again after.
        if (IsZoomed(window)) ShowWindow(window, SW_RESTORE);
        state.windowedStyle = GetWindowLongPtrW(window, GWL_STYLE);
        SetWindowLongPtrW(window, GWL_STYLE, (state.windowedStyle & ~WS_OVERLAPPEDWINDOW) | WS_POPUP);
        cover(window, *screen, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        // A window minimized meanwhile stays so.
        if (IsIconic(window)) state.windowedPlace.showCmd = SW_SHOWMINNOACTIVE;
        SetWindowLongPtrW(window, GWL_STYLE, state.windowedStyle);
        SetWindowPlacement(window, &state.windowedPlace);
        SetWindowPos(window, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
    state.isFullScreen = isFull;
}

// webview sizes a window anew for a new scale, and Windows leaves it as it was for a new screen size: a window that
// filled its screen fills it again.
void fitFullScreen(HWND window) {
    const auto found = made.find(window);
    const std::optional<RECT> screen = found != made.end() && found->second.isFullScreen ? screenOf(window, false) : std::nullopt;
    if (screen) cover(window, *screen, SWP_NOZORDER | SWP_NOACTIVATE);
}

void holdToLimits(const Win32Window &state, HWND window, MINMAXINFO &limits) {
    if (state.minWidth > 0 || state.minHeight > 0) {
        const SIZE least = frameOf(window, state.minWidth, state.minHeight);
        limits.ptMinTrackSize = {least.cx, least.cy};
    }
    if (state.maxWidth > 0 || state.maxHeight > 0) {
        // Maximized, the window keeps to its monitor on a side whose limit is larger.
        const SIZE most = frameOf(window, state.maxWidth > 0 ? state.maxWidth : MAX_SIZE, state.maxHeight > 0 ? state.maxHeight : MAX_SIZE);
        limits.ptMaxTrackSize = {most.cx, most.cy};
        limits.ptMaxSize = {std::min(limits.ptMaxSize.x, most.cx), std::min(limits.ptMaxSize.y, most.cy)};
    }
}

// The host's procedure takes a window's messages before webview's, and an extension's subclass before the host's.
LRESULT CALLBACK hostProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    const auto found = made.find(window);
    if (found == made.end()) return DefWindowProcW(window, message, wParam, lParam);
    const Win32Window &state = found->second;
    const WNDPROC procedure = state.procedure;
    switch (message) {
    // The window asks the app's extensions as its user closes it, and the host closes it; app.quit() ends the app
    // without asking.
    case WM_CLOSE:
        app::closeAsked(state.id);
        return 0;
    // So do signing out and shutting down, but for the Restart Manager's close to service the system, and the session
    // ends once every app has returned from WM_ENDSESSION: the app's oldest window asks for it.
    case WM_QUERYENDSESSION:
        if (window == crossbind::appWindow()) return (lParam & ENDSESSION_CLOSEAPP) || app::isQuitAllowed() ? TRUE : FALSE;
        break;
    case WM_ENDSESSION:
        if (wParam && window == crossbind::appWindow() && quitWithSession) quitWithSession();
        break;
    case WM_ACTIVATEAPP:
        app::appActivated(wParam != FALSE);
        break;
    case WM_ACTIVATE:
        if (LOWORD(wParam) != WA_INACTIVE) app::windowFocused(state.id);
        break;
    case WM_GETMINMAXINFO: {
        const LRESULT result = CallWindowProcW(procedure, window, message, wParam, lParam);
        holdToLimits(state, window, *reinterpret_cast<MINMAXINFO *>(lParam));
        return result;
    }
    case WM_DPICHANGED:
    case WM_DISPLAYCHANGE: {
        const LRESULT result = CallWindowProcW(procedure, window, message, wParam, lParam);
        fitFullScreen(window);
        return result;
    }
    default:
        break;
    }
    return CallWindowProcW(procedure, window, message, wParam, lParam);
}

LONG_PTR styleOf(LONG_PTR style, bool isResizable) {
    return isResizable ? style | WS_THICKFRAME | WS_MAXIMIZEBOX : style & ~(WS_THICKFRAME | WS_MAXIMIZEBOX);
}

}  // namespace

void startWindows() {}

// The library makes the window, which it sizes anew at each scale.
void *makeWindow(const app::WindowOptions &, void *, std::vector<std::string> &) { return nullptr; }

void readyWindow(void *native, void *, uint64_t id, const app::WindowOptions &options, void *parent, std::vector<std::string> &ignored) {
    HWND window = static_cast<HWND>(native);
    // A page under the title bar's buttons is macOS's alone; Windows keeps its title bar.
    if (options.titleBarHidden) ignored.emplace_back("titleBar");
    Win32Window &state = made[window];
    state.id = id;
    state.minWidth = options.minWidth;
    state.minHeight = options.minHeight;
    state.maxWidth = options.maxWidth;
    state.maxHeight = options.maxHeight;
    state.opensFullScreen = options.fullscreen;
    SetWindowTextW(window, wide(options.title).c_str());
    LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    // A window without a frame keeps its border, which resizes it.
    if (!options.frame) style = (style & ~WS_OVERLAPPEDWINDOW) | WS_POPUP | WS_MINIMIZEBOX | WS_SYSMENU;
    SetWindowLongPtrW(window, GWL_STYLE, styleOf(style, options.resizable));
    // An owned window stays above its owner, and minimizes with it.
    if (parent) SetWindowLongPtrW(window, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(parent));
    state.procedure = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(hostProcedure)));
    const SIZE frame = frameOf(window, options.width, options.height);
    SetWindowPos(window, options.alwaysOnTop ? HWND_TOPMOST : nullptr, 0, 0, frame.cx, frame.cy,
        SWP_NOMOVE | SWP_NOACTIVATE | SWP_FRAMECHANGED | (options.alwaysOnTop ? 0 : SWP_NOZORDER));
    if (options.x) {
        SetWindowPos(window, nullptr, physical(*options.x, window), physical(*options.y, window), 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    } else {
        center(window, options.modal ? static_cast<HWND>(parent) : nullptr);
    }
}

void presentWindow(void *native, void *, const app::WindowOptions &options, void *parent) {
    HWND window = static_cast<HWND>(native);
    if (parent && options.modal && modalsOver[static_cast<HWND>(parent)]++ == 0) EnableWindow(static_cast<HWND>(parent), FALSE);
    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);
    SetFocus(window);
    if (options.fullscreen) setFullScreen(window, true);
}

void changeWindow(void *native, void *, const app::WindowChanges &changes, std::vector<std::string> &) {
    HWND window = static_cast<HWND>(native);
    Win32Window &state = made.at(window);
    if (changes.title) SetWindowTextW(window, wide(*changes.title).c_str());
    if (changes.minWidth) state.minWidth = *changes.minWidth;
    if (changes.minHeight) state.minHeight = *changes.minHeight;
    if (changes.maxWidth) state.maxWidth = *changes.maxWidth;
    if (changes.maxHeight) state.maxHeight = *changes.maxHeight;
    if (changes.resizable && !state.isFullScreen) {
        SetWindowLongPtrW(window, GWL_STYLE, styleOf(GetWindowLongPtrW(window, GWL_STYLE), *changes.resizable));
        SetWindowPos(window, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
    if (changes.width || changes.height) {
        RECT page{};
        GetClientRect(window, &page);
        const SIZE frame = frameOf(window, changes.width.value_or(logical(page.right, window)), changes.height.value_or(logical(page.bottom, window)));
        SetWindowPos(window, nullptr, 0, 0, frame.cx, frame.cy, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    if (changes.x) {
        SetWindowPos(window, nullptr, physical(*changes.x, window), physical(*changes.y, window), 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    } else if (changes.center) {
        center(window, nullptr);
    }
    if (changes.alwaysOnTop) SetWindowPos(window, *changes.alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    if (changes.fullscreen) {
        state.opensFullScreen = *changes.fullscreen;
        setFullScreen(window, *changes.fullscreen);
    }
}

app::WindowState stateOfWindow(void *native, void *) {
    HWND window = static_cast<HWND>(native);
    app::WindowState told;
    const int length = GetWindowTextLengthW(window);
    std::wstring title(static_cast<size_t>(length) + 1, L'\0');
    GetWindowTextW(window, title.data(), length + 1);
    title.resize(static_cast<size_t>(length));
    told.title = utf8(title.c_str());
    RECT frame{};
    GetWindowRect(window, &frame);
    told.x = logical(frame.left, window);
    told.y = logical(frame.top, window);
    RECT page{};
    GetClientRect(window, &page);
    told.width = logical(page.right - page.left, window);
    told.height = logical(page.bottom - page.top, window);
    told.isMaximized = IsZoomed(window) != FALSE;
    told.isMinimized = IsIconic(window) != FALSE;
    const auto found = made.find(window);
    told.isFullscreen = found != made.end() && found->second.isFullScreen;
    told.isFocused = GetForegroundWindow() == window;
    return told;
}

void focusWindow(void *native) {
    HWND window = static_cast<HWND>(native);
    if (IsIconic(window)) ShowWindow(window, SW_RESTORE);
    SetForegroundWindow(window);
}

void minimizeWindow(void *native) { ShowWindow(static_cast<HWND>(native), SW_MINIMIZE); }

void toggleMaximizeWindow(void *native) {
    HWND window = static_cast<HWND>(native);
    ShowWindow(window, IsZoomed(window) ? SW_RESTORE : SW_MAXIMIZE);
}

// The press goes on as one on the window's caption, which Windows moves the window with.
// A move starts from the press of the primary button on the page while it is down.
void dragWindow(void *native) {
    if ((GetAsyncKeyState(GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON) & 0x8000) == 0) return;
    POINT cursor{};
    GetCursorPos(&cursor);
    ReleaseCapture();
    PostMessageW(static_cast<HWND>(native), WM_NCLBUTTONDOWN, HTCAPTION, MAKELPARAM(cursor.x, cursor.y));
}

// The owner takes input again before its last modal window goes, so Windows hands it the front; the library destroys the
// window it made as it lets go of it.
void destroyWindow(void *native, void *parent, bool isModal, const std::function<void()> &letGo) {
    HWND owner = static_cast<HWND>(parent);
    if (isModal && owner && --modalsOver[owner] == 0) {
        modalsOver.erase(owner);
        EnableWindow(owner, TRUE);
    }
    made.erase(static_cast<HWND>(native));
    letGo();
}

// The extensions hear how the app is once its first window has shown, which may not have taken the foreground, of which
// WM_ACTIVATEAPP tells.
void runLoop() {
    onMainThread([] {
        DWORD process = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &process);
        app::appActivated(process == GetCurrentProcessId());
    });
    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
}

void endLoop() { PostQuitMessage(0); }

// The app ends with its last window, and with its user's session; anything else ends the process as it ends any other.
void onQuit(std::function<void()> quit) { quitWithSession = std::move(quit); }

void followPageFullScreen(void *controller) {
    auto *changed = new Handler<ICoreWebView2ContainsFullScreenElementChangedEventHandler, ICoreWebView2 *, IUnknown *>(
        IID_ICoreWebView2ContainsFullScreenElementChangedEventHandler, [controller](ICoreWebView2 *sender, IUnknown *) -> HRESULT {
            HWND widget = nullptr;
            BOOL hasElement = FALSE;
            if (FAILED(static_cast<ICoreWebView2Controller *>(controller)->get_ParentWindow(&widget)) || FAILED(sender->get_ContainsFullScreenElement(&hasElement))) {
                return S_OK;
            }
            HWND window = GetAncestor(widget, GA_ROOT);
            const auto found = made.find(window);
            setFullScreen(window, hasElement || (found != made.end() && found->second.opensFullScreen));
            return S_OK;
        });
    EventRegistrationToken token;
    coreWebView(controller)->add_ContainsFullScreenElementChanged(changed, &token);
    changed->Release();
}

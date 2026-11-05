#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "platform.h"
#include "windows/com.h"

#include <knownfolders.h>
#include <shlobj.h>
#include <shlwapi.h>

#include <stdexcept>

using namespace crossbind::windows;

namespace {

HWND mainWindow = nullptr;
void *mainWebView = nullptr;
WNDPROC windowProcedure = nullptr;

std::string knownFolder(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr;
    if (FAILED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &path))) throw std::runtime_error("crossbind: Windows names no folder for the app's files");
    std::string out = utf8(path);
    CoTaskMemFree(path);
    return out;
}

std::string made(const std::string &path) {
    const int result = SHCreateDirectoryExW(nullptr, wide(path).c_str(), nullptr);
    if (result != ERROR_SUCCESS && result != ERROR_ALREADY_EXISTS && result != ERROR_FILE_EXISTS) {
        throw std::runtime_error("crossbind: cannot make the app's folder " + path);
    }
    return path;
}

bool exists(const std::string &path) { return GetFileAttributesW(wide(path).c_str()) != INVALID_FILE_ATTRIBUTES; }

// webview sizes the window anew for a new scale, and Windows leaves it as it was for a new screen size: a window that
// filled its screen fills it again.
LRESULT CALLBACK hostProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_DPICHANGED || message == WM_DISPLAYCHANGE) {
        const LRESULT result = CallWindowProcW(windowProcedure, hwnd, message, wParam, lParam);
        fitFullScreen();
        return result;
    }
    return CallWindowProcW(windowProcedure, hwnd, message, wParam, lParam);
}

}  // namespace

// What the app keeps roams with its user, as Windows apps do; its cache and logs stay on the machine.
crossbind::app::Paths appPaths() {
    const std::string id = CROSSBIND_APP_ID;
    const std::string local = knownFolder(FOLDERID_LocalAppData) + "\\" + id;
    return {made(knownFolder(FOLDERID_RoamingAppData) + "\\" + id), made(local + "\\Cache"), made(local + "\\Logs")};
}

// The profile is the page's cache as much as its storage, so it stays on the machine with the app's cache. A release
// before kept it where webview does, under the executable's name in the roaming folder: it moves here once, and where it
// cannot, as when the roaming folder is on another disk, the page keeps it there. A launch beside it may move it first.
std::wstring webViewProfile() {
    const std::string profile = made(knownFolder(FOLDERID_LocalAppData) + "\\" + CROSSBIND_APP_ID) + "\\WebView2";
    const std::wstring executable = executablePath();
    const std::string old = knownFolder(FOLDERID_RoamingAppData) + "\\" + utf8(PathFindFileNameW(executable.c_str()));
    if (!exists(profile) && exists(old)) MoveFileExW(wide(old).c_str(), wide(profile).c_str(), 0);
    return wide(exists(profile) || !exists(old) ? profile : old);
}

void crossbind::onMainThread(std::function<void()> fn) { windows::onMainThread(std::move(fn)); }

void quitApp() {
    onMainThread([] {
        if (mainWindow) PostMessageW(mainWindow, WM_CLOSE, 0, 0);
    });
}

// The host's procedure takes the window's messages before webview's, and an extension's subclass before the host's.
void setMainWindow(void *window, void *webView) {
    mainWindow = static_cast<HWND>(window);
    mainWebView = webView;
    windowProcedure = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(mainWindow, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(hostProcedure)));
}

void *crossbind::appWindow() { return mainWindow; }

void *crossbind::appWebView() { return mainWebView; }

void showWindow(const std::string &) {
    onMainThread([] {
        if (!mainWindow) return;
        if (IsIconic(mainWindow)) ShowWindow(mainWindow, SW_RESTORE);
        SetForegroundWindow(mainWindow);
    });
}

namespace {

// The window's frame and place before it filled the screen, to which it goes back.
LONG_PTR windowedStyle = 0;
WINDOWPLACEMENT windowedPlace{};
bool isFullScreen = false;
// app.window.fullscreen, to which the window goes back once the page's element leaves the screen.
bool opensFullScreen = false;

// The whole of the screen the window is on.
std::optional<RECT> screenOf(HWND window) {
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    if (!GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor)) return std::nullopt;
    return monitor.rcMonitor;
}

void cover(const RECT &screen, UINT flags) {
    SetWindowPos(mainWindow, HWND_TOP, screen.left, screen.top, screen.right - screen.left, screen.bottom - screen.top, flags);
}

// A window that fills the screen is a popup without a frame, whose size Windows does not hold to app.window's limits.
void setFullScreen(bool isFull) {
    if (!mainWindow || isFull == isFullScreen) return;
    if (isFull) {
        windowedPlace.length = sizeof(windowedPlace);
        const std::optional<RECT> screen = screenOf(mainWindow);
        if (!GetWindowPlacement(mainWindow, &windowedPlace) || !screen) return;
        // Windows keeps the taskbar over a maximized window; the placement maximizes it again after.
        if (IsZoomed(mainWindow)) ShowWindow(mainWindow, SW_RESTORE);
        windowedStyle = GetWindowLongPtrW(mainWindow, GWL_STYLE);
        SetWindowLongPtrW(mainWindow, GWL_STYLE, (windowedStyle & ~WS_OVERLAPPEDWINDOW) | WS_POPUP);
        cover(*screen, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        // A window minimized meanwhile stays so.
        if (IsIconic(mainWindow)) windowedPlace.showCmd = SW_SHOWMINNOACTIVE;
        SetWindowLongPtrW(mainWindow, GWL_STYLE, windowedStyle);
        SetWindowPlacement(mainWindow, &windowedPlace);
        SetWindowPos(mainWindow, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
    isFullScreen = isFull;
}

}  // namespace

void setBackgroundColor(void *, void *webView, std::uint32_t color) {
    ICoreWebView2Controller2 *controller = nullptr;
    if (FAILED(static_cast<ICoreWebView2Controller *>(webView)->QueryInterface(IID_ICoreWebView2Controller2, reinterpret_cast<void **>(&controller)))) {
        return;
    }
    controller->put_DefaultBackgroundColor({255, static_cast<BYTE>(color >> 16), static_cast<BYTE>(color >> 8), static_cast<BYTE>(color)});
    controller->Release();
}

void fillScreen() {
    opensFullScreen = true;
    setFullScreen(true);
}

void fitFullScreen() {
    const std::optional<RECT> screen = isFullScreen ? screenOf(mainWindow) : std::nullopt;
    if (screen) cover(*screen, SWP_NOZORDER | SWP_NOACTIVATE);
}

void followPageFullScreen(void *controller) {
    auto *changed = new Handler<ICoreWebView2ContainsFullScreenElementChangedEventHandler, ICoreWebView2 *, IUnknown *>(
        IID_ICoreWebView2ContainsFullScreenElementChangedEventHandler, [](ICoreWebView2 *sender, IUnknown *) -> HRESULT {
            BOOL hasElement = FALSE;
            if (SUCCEEDED(sender->get_ContainsFullScreenElement(&hasElement))) setFullScreen(hasElement || opensFullScreen);
            return S_OK;
        });
    EventRegistrationToken token;
    coreWebView(controller)->add_ContainsFullScreenElementChanged(changed, &token);
    changed->Release();
}

#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "platform.h"
#include "windows/com.h"

#include <knownfolders.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shobjidl.h>

#include <algorithm>
#include <cstdio>
#include <stdexcept>

using namespace crossbind::windows;

namespace {

HWND mainWindow = nullptr;

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

void openUrl(std::string url, std::function<void(Failure)> done) {
    onMainThread([url = std::move(url), done = std::move(done)] {
        done(openOutside(url) ? Failure() : Failure("crossbind: nothing opens " + url));
    });
}

void openFile(std::string path, std::function<void(Failure)> done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        if (!exists(path)) {
            done("crossbind: there is no " + path);
            return;
        }
        const auto opened = reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide(path).c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        done(opened > 32 ? Failure() : Failure("crossbind: nothing opens " + path));
    });
}

void revealFile(std::string path, std::function<void(Failure)> done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        // The shell reads a path with backslashes alone.
        std::wstring native = wide(path);
        std::replace(native.begin(), native.end(), L'/', L'\\');
        PIDLIST_ABSOLUTE item = exists(path) ? ILCreateFromPathW(native.c_str()) : nullptr;
        if (!item) {
            done("crossbind: there is no " + path);
            return;
        }
        const HRESULT shown = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
        ILFree(item);
        done(SUCCEEDED(shown) ? Failure() : Failure("crossbind: Explorer cannot show " + path));
    });
}

namespace {

// Aborts a deletion that would not go to the Recycle Bin, as IFileOperation makes of an item on a drive without one,
// such as a network share: it would delete the item for good.
class RecycleOnly final : public IFileOperationProgressSink {
public:
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!out) return E_POINTER;
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, IID_IFileOperationProgressSink)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<IFileOperationProgressSink *>(this);
        AddRef();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE PreDeleteItem(DWORD flags, IShellItem *) override { return flags & TSF_DELETE_RECYCLE_IF_POSSIBLE ? S_OK : E_ABORT; }
    HRESULT STDMETHODCALLTYPE StartOperations() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE FinishOperations(HRESULT) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreRenameItem(DWORD, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostRenameItem(DWORD, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    // With no UI, an item that stays, as a file another program holds, fails here alone.
    HRESULT STDMETHODCALLTYPE PostDeleteItem(DWORD, IShellItem *, HRESULT result, IShellItem *) override {
        if (FAILED(result)) failure = result;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE PreNewItem(DWORD, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostNewItem(DWORD, IShellItem *, LPCWSTR, LPCWSTR, DWORD, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE UpdateProgress(UINT, UINT) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE ResetTimer() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PauseTimer() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE ResumeTimer() override { return S_OK; }

    HRESULT failure = S_OK;

private:
    std::atomic<ULONG> refs_{1};
};

}  // namespace

void trashFile(std::string path, std::function<void(Failure)> done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        if (!exists(path)) {
            done("crossbind: there is no " + path);
            return;
        }
        // The shell reads a path with backslashes alone.
        std::wstring native = wide(path);
        std::replace(native.begin(), native.end(), L'/', L'\\');
        IFileOperation *operation = nullptr;
        IShellItem *item = nullptr;
        auto *sink = new RecycleOnly();
        DWORD cookie = 0;
        BOOL isAborted = FALSE;
        HRESULT result = CoCreateInstance(CLSID_FileOperation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&operation));
        if (SUCCEEDED(result)) result = operation->SetOperationFlags(FOF_NO_UI | FOFX_RECYCLEONDELETE);
        if (SUCCEEDED(result)) result = SHCreateItemFromParsingName(native.c_str(), nullptr, IID_PPV_ARGS(&item));
        if (SUCCEEDED(result)) result = operation->Advise(sink, &cookie);
        if (SUCCEEDED(result)) result = operation->DeleteItem(item, nullptr);
        if (SUCCEEDED(result)) result = operation->PerformOperations();
        if (SUCCEEDED(result)) result = sink->failure;
        if (operation) operation->GetAnyOperationsAborted(&isAborted);
        if (cookie) operation->Unadvise(cookie);
        if (item) item->Release();
        if (operation) operation->Release();
        sink->Release();
        if (isAborted) {
            done("crossbind: cannot move " + path + " to the Recycle Bin, which its drive has none of");
        } else if (FAILED(result)) {
            char code[sizeof "0x00000000"];
            std::snprintf(code, sizeof code, "0x%08lx", static_cast<unsigned long>(result));
            done("crossbind: cannot move " + path + " to the Recycle Bin: " + code);
        } else {
            done(std::nullopt);
        }
    });
}

void quitApp() {
    onMainThread([] {
        if (mainWindow) PostMessageW(mainWindow, WM_CLOSE, 0, 0);
    });
}

void setMainWindow(void *window) { mainWindow = static_cast<HWND>(window); }

void *crossbind::appWindow() { return mainWindow; }

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

#include "crossbind_app.h"
#include "platform.h"
#include "windows/com.h"

#include <commctrl.h>
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
// A message dialog's own buttons are numbered past the common ones, IDOK to IDCONTINUE.
constexpr int FIRST_BUTTON = 100;

// A dialog's file types, as COMDLG_FILTERSPECs pointing into the strings beside them.
struct FileTypes {
    std::vector<std::wstring> names;
    std::vector<std::wstring> patterns;
    std::vector<COMDLG_FILTERSPEC> specs;
};

FileTypes fileTypesOf(const std::vector<crossbind::app::FileFilter> &filters) {
    FileTypes types;
    for (const auto &filter : filters) {
        std::wstring pattern;
        for (const auto &extension : filter.extensions) pattern += (pattern.empty() ? L"*." : L";*.") + wide(extension);
        types.names.push_back(wide(filter.name));
        types.patterns.push_back(pattern);
    }
    for (size_t i = 0; i < filters.size(); i += 1) types.specs.push_back({types.names[i].c_str(), types.patterns[i].c_str()});
    return types;
}

void setUp(IFileDialog *dialog, const std::string &title, const std::string &folder, const FileTypes &types) {
    if (!title.empty()) dialog->SetTitle(wide(title).c_str());
    IShellItem *start = nullptr;
    if (!folder.empty() && SUCCEEDED(SHCreateItemFromParsingName(wide(folder).c_str(), nullptr, IID_PPV_ARGS(&start)))) {
        dialog->SetFolder(start);
        start->Release();
    }
    if (!types.specs.empty()) dialog->SetFileTypes(static_cast<UINT>(types.specs.size()), types.specs.data());
}

std::string pathOf(IShellItem *item) {
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) return {};
    std::string out = utf8(path);
    CoTaskMemFree(path);
    return out;
}

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

// The caller of a dialog that could not show hears no more than of one cancelled, so the reason goes to the output.
void report(const char *dialog, HRESULT result) {
    if (FAILED(result) && result != HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
        std::fprintf(stderr, "crossbind: the %s dialog failed: 0x%08lx\n", dialog, static_cast<unsigned long>(result));
    }
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

// Modal to the app's window, as the system's file dialogs are.
void showOpenDialog(crossbind::app::OpenOptions options, std::function<void(Picked)> done) {
    onMainThread([options = std::move(options), done = std::move(done)] {
        IFileOpenDialog *dialog = nullptr;
        if (const HRESULT made = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)); FAILED(made)) {
            report("open", made);
            done(std::nullopt);
            return;
        }
        FILEOPENDIALOGOPTIONS flags = 0;
        dialog->GetOptions(&flags);
        dialog->SetOptions(flags | FOS_FORCEFILESYSTEM | (options.directory ? FOS_PICKFOLDERS : 0) | (options.multiple ? FOS_ALLOWMULTISELECT : 0));
        const FileTypes types = fileTypesOf(options.filters);
        setUp(dialog, options.title, options.defaultPath, types);
        Picked picked;
        IShellItemArray *items = nullptr;
        const HRESULT shown = dialog->Show(mainWindow);
        report("open", shown);
        if (SUCCEEDED(shown) && SUCCEEDED(dialog->GetResults(&items))) {
            picked.emplace();
            DWORD count = 0;
            items->GetCount(&count);
            for (DWORD i = 0; i < count; i += 1) {
                IShellItem *item = nullptr;
                if (FAILED(items->GetItemAt(i, &item))) continue;
                picked->push_back(pathOf(item));
                item->Release();
            }
            items->Release();
        }
        dialog->Release();
        done(std::move(picked));
    });
}

void showSaveDialog(crossbind::app::SaveOptions options, std::function<void(std::optional<std::string>)> done) {
    onMainThread([options = std::move(options), done = std::move(done)] {
        IFileSaveDialog *dialog = nullptr;
        if (const HRESULT made = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)); FAILED(made)) {
            report("save", made);
            done(std::nullopt);
            return;
        }
        FILEOPENDIALOGOPTIONS flags = 0;
        dialog->GetOptions(&flags);
        dialog->SetOptions(flags | FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT);
        const FileTypes types = fileTypesOf(options.filters);
        setUp(dialog, options.title, options.defaultPath, types);
        if (!options.defaultName.empty()) dialog->SetFileName(wide(options.defaultName).c_str());
        // A name typed without an extension takes the first file type's.
        if (!options.filters.empty() && !options.filters[0].extensions.empty()) {
            dialog->SetDefaultExtension(wide(options.filters[0].extensions[0]).c_str());
        }
        std::optional<std::string> file;
        IShellItem *item = nullptr;
        const HRESULT shown = dialog->Show(mainWindow);
        report("save", shown);
        if (SUCCEEDED(shown) && SUCCEEDED(dialog->GetResult(&item))) {
            file = pathOf(item);
            item->Release();
        }
        dialog->Release();
        done(std::move(file));
    });
}

// Modal to the app's window, as a message box is.
void showMessageDialog(crossbind::app::MessageOptions options, std::function<void(int)> done) {
    onMainThread([options = std::move(options), done = std::move(done)] {
        const std::wstring title = wide(CROSSBIND_APP_NAME);
        const std::wstring message = wide(options.message);
        const std::wstring detail = wide(options.detail);
        std::vector<std::wstring> labels;
        for (const auto &label : options.buttons) {
            // A label's ampersands stay as they are, as no access key takes them.
            std::wstring text;
            for (const wchar_t c : wide(label)) text += c == L'&' ? L"&&" : std::wstring(1, c);
            labels.push_back(text);
        }
        std::vector<TASKDIALOG_BUTTON> buttons;
        for (size_t i = 0; i < labels.size(); i += 1) buttons.push_back({FIRST_BUTTON + static_cast<int>(i), labels[i].c_str()});
        TASKDIALOGCONFIG config{};
        config.cbSize = sizeof config;
        config.hwndParent = mainWindow;
        // Escape and closing the dialog answer IDCANCEL.
        config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW;
        config.dwCommonButtons = buttons.empty() ? TDCBF_OK_BUTTON : 0;
        config.pszWindowTitle = title.c_str();
        config.pszMainIcon = options.kind == crossbind::app::MessageKind::error     ? TD_ERROR_ICON
                             : options.kind == crossbind::app::MessageKind::warning ? TD_WARNING_ICON
                                                                                    : TD_INFORMATION_ICON;
        config.pszMainInstruction = message.c_str();
        if (!detail.empty()) config.pszContent = detail.c_str();
        config.cButtons = static_cast<UINT>(buttons.size());
        config.pButtons = buttons.data();
        config.nDefaultButton = buttons.empty() ? IDOK : FIRST_BUTTON;
        int clicked = IDCANCEL;
        const HRESULT shown = TaskDialogIndirect(&config, &clicked, nullptr, nullptr);
        report("message", shown);
        done(FAILED(shown) || clicked == IDCANCEL ? NO_BUTTON : clicked == IDOK ? 0 : clicked - FIRST_BUTTON);
    });
}

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

void quitApp() {
    onMainThread([] {
        if (mainWindow) PostMessageW(mainWindow, WM_CLOSE, 0, 0);
    });
}

void setMainWindow(void *window) { mainWindow = static_cast<HWND>(window); }

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

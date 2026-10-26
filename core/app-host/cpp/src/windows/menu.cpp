#include "host_core.h"
#include "platform.h"
#include "windows/com.h"

#include <shellapi.h>
#include <windowsx.h>

#include <algorithm>
#include <cctype>
#include <map>
#include <stdexcept>
#include <utility>
#include <vector>

using namespace crossbind::windows;

namespace {

// Commands below it are the window's own.
constexpr UINT FIRST_COMMAND = 0x1000;
// An accelerator's item, which the webview's key handler posts with the generation of the menus it was pressed in.
constexpr UINT WM_SHORTCUT = WM_APP + 1;
// Sets the menus the page set while one of the bar's was open.
constexpr UINT WM_MENUS_WAITING = WM_APP + 2;
// What Windows tells of the tray's icon, which it sends the tray's window.
constexpr UINT WM_TRAY = WM_APP + 3;
// The one icon the app puts in the notification area.
constexpr UINT TRAY_ICON = 1;
// The app's icon among its resources, which app.rc gives the id of Windows' own.
constexpr WORD APP_ICON = 32512;

// What a click of an item does: one of the page's tells the page its id, a standard one does what its role says.
struct Command {
    std::string id;
    std::string role;
    bool isCheck = false;
};

// An accelerator, which reaches the menus from the webview, as it holds the keyboard.
struct Shortcut {
    UINT key;
    bool control;
    bool alt;
    bool shift;
    UINT index;
};

struct Built {
    std::vector<Command> commands;
    std::vector<Shortcut> shortcuts;
};

// A standard item's label and the accelerator Windows apps show for it. The webview does the editing ones when its user
// presses that key with Ctrl, which a click sends it.
struct Role {
    const wchar_t *label;
    const wchar_t *shortcut;
    WORD editKey;
};

const std::map<std::string, Role> ROLES{
    {"undo", {L"Undo", L"Ctrl+Z", 'Z'}},      {"redo", {L"Redo", L"Ctrl+Y", 'Y'}},   {"cut", {L"Cut", L"Ctrl+X", 'X'}},
    {"copy", {L"Copy", L"Ctrl+C", 'C'}},      {"paste", {L"Paste", L"Ctrl+V", 'V'}}, {"selectAll", {L"Select All", L"Ctrl+A", 'A'}},
    {"minimize", {L"Minimize", L"", 0}},      {"close", {L"Close", L"", 0}},         {"quit", {L"Exit", L"Alt+F4", 0}},
};

const std::map<std::string, UINT> NAMED_KEYS{
    {"Enter", VK_RETURN},  {"Escape", VK_ESCAPE}, {"Tab", VK_TAB},         {"Space", VK_SPACE},      {"Backspace", VK_BACK},
    {"Delete", VK_DELETE}, {"Up", VK_UP},         {"Down", VK_DOWN},       {"Left", VK_LEFT},        {"Right", VK_RIGHT},
    {"Home", VK_HOME},     {"End", VK_END},       {"PageUp", VK_PRIOR},    {"PageDown", VK_NEXT},    {"Plus", VK_OEM_PLUS},
    {"Minus", VK_OEM_MINUS}, {"Comma", VK_OEM_COMMA}, {"Period", VK_OEM_PERIOD},
};

HWND window = nullptr;
ICoreWebView2Controller *controller = nullptr;
WNDPROC windowProcedure = nullptr;
HMENU bar = nullptr;
Built built;
MenuClicked onClick;
// Each change of the menus moves it on, so an accelerator pressed before one runs nothing after it.
LPARAM generation = 0;
std::vector<std::function<void()>> waiting;

// A hidden window takes the tray icon's messages. As a top-level one, it hears as well that Explorer started anew, as
// after a crash, without the icons it showed.
HWND trayWindow = nullptr;
UINT taskbarCreated = 0;
HMENU trayMenu = nullptr;
Built trayBuilt;
std::wstring trayTip;
// An icon shows in the notification area while the page sets the tray, or while a notification comes from it.
bool isTraySet = false;
bool isIconShown = false;
// The notifications shown from an icon the page did not set, which goes with the last.
int balloons = 0;
bool isTrayMenuOpen = false;
std::vector<std::function<void()>> trayWaiting;

UINT keyOf(const Accelerator &accelerator) {
    const std::string &key = accelerator.key;
    if (accelerator.function) return VK_F1 + static_cast<UINT>(accelerator.function) - 1;
    if (key.size() == 1) return static_cast<UINT>(std::toupper(static_cast<unsigned char>(key[0])));
    const auto named = NAMED_KEYS.find(key);
    if (named == NAMED_KEYS.end()) throw std::invalid_argument("crossbind: no accelerator has the key " + key);
    return named->second;
}

std::wstring shortcutText(const Accelerator &accelerator) {
    return std::wstring(accelerator.control ? L"Ctrl+" : L"") + (accelerator.alt ? L"Alt+" : L"") + (accelerator.shift ? L"Shift+" : L"") +
           wide(accelerator.key);
}

// Windows reads & in a label as the start of a mnemonic.
std::wstring labelOf(const std::string &label) {
    std::wstring out;
    for (const wchar_t c : wide(label)) out += c == L'&' ? std::wstring(L"&&") : std::wstring(1, c);
    return out;
}

// One of the window's own, not of a dialog it shows.
bool isMenuOpen() {
    GUITHREADINFO info{};
    info.cbSize = sizeof(info);
    return GetGUIThreadInfo(GetCurrentThreadId(), &info) && (info.flags & GUI_INMENUMODE) && info.hwndMenuOwner == window;
}

void runRole(const std::string &role) {
    const auto found = ROLES.find(role);
    if (found != ROLES.end() && found->second.editKey) {
        if (controller) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        INPUT keys[4] = {};
        for (auto &key : keys) key.type = INPUT_KEYBOARD;
        keys[0].ki.wVk = VK_CONTROL;
        keys[1].ki.wVk = found->second.editKey;
        keys[2].ki.wVk = found->second.editKey;
        keys[2].ki.dwFlags = KEYEVENTF_KEYUP;
        keys[3].ki.wVk = VK_CONTROL;
        keys[3].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(4, keys, sizeof(INPUT));
    } else if (role == "minimize") {
        ShowWindow(window, SW_MINIMIZE);
    } else {
        PostMessageW(window, WM_CLOSE, 0, 0);
    }
}

// An item of the bar's menus or of the tray's, by its index among their commands.
void run(HMENU menu, const Built &from, UINT index) {
    const UINT command = FIRST_COMMAND + index;
    if (index >= from.commands.size() || (GetMenuState(menu, command, MF_BYCOMMAND) & (MF_GRAYED | MF_DISABLED))) return;
    const Command &item = from.commands[index];
    if (!item.role.empty()) {
        runRole(item.role);
        return;
    }
    std::optional<bool> checked;
    if (item.isCheck) {
        checked = !(GetMenuState(menu, command, MF_BYCOMMAND) & MF_CHECKED);
        CheckMenuItem(menu, command, MF_BYCOMMAND | (*checked ? MF_CHECKED : MF_UNCHECKED));
    }
    if (onClick && !item.id.empty()) onClick(item.id, checked);
}

// Cut to what Windows keeps.
template <size_t N>
void copyText(wchar_t (&into)[N], const std::wstring &text) {
    const size_t length = std::min(text.size(), N - 1);
    std::copy_n(text.data(), length, into);
    into[length] = L'\0';
}

// The app's icon at one of Windows' sizes, or Windows' own for an app without one.
HICON iconAt(int metric) {
    const int size = GetSystemMetrics(metric);
    if (auto *own = static_cast<HICON>(LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(APP_ICON), IMAGE_ICON, size, size, 0))) return own;
    return static_cast<HICON>(LoadImageW(nullptr, MAKEINTRESOURCEW(APP_ICON), IMAGE_ICON, size, size, LR_SHARED));
}

NOTIFYICONDATAW iconData(UINT flags) {
    NOTIFYICONDATAW data{};
    data.cbSize = sizeof(data);
    data.hWnd = trayWindow;
    data.uID = TRAY_ICON;
    data.uFlags = flags | NIF_TIP | NIF_SHOWTIP;
    copyText(data.szTip, trayTip);
    return data;
}

bool showIcon() {
    static const HICON icon = iconAt(SM_CXSMICON);
    NOTIFYICONDATAW data = iconData(NIF_MESSAGE | NIF_ICON);
    data.uCallbackMessage = WM_TRAY;
    data.hIcon = icon;
    if (!Shell_NotifyIconW(NIM_ADD, &data)) return false;
    data.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &data);
    isIconShown = true;
    return true;
}

void hideIcon() {
    if (isIconShown) {
        NOTIFYICONDATAW data = iconData(0);
        Shell_NotifyIconW(NIM_DELETE, &data);
    }
    isIconShown = false;
    balloons = 0;
}

// Why the icon did not show, right after Windows took none.
std::string noNotificationArea() {
    return "crossbind: Windows' notification area did not take the app's icon: error " + std::to_string(GetLastError());
}

LRESULT CALLBACK menuProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_COMMAND && HIWORD(wParam) == 0 && lParam == 0 && LOWORD(wParam) >= FIRST_COMMAND) {
        run(bar, built, LOWORD(wParam) - FIRST_COMMAND);
        return 0;
    }
    if (message == WM_SHORTCUT) {
        if (lParam == generation) run(bar, built, static_cast<UINT>(wParam));
        return 0;
    }
    if (message == WM_EXITMENULOOP && !waiting.empty()) PostMessageW(hwnd, WM_MENUS_WAITING, 0, 0);
    // Posted once more, so the command of a click on the menu that closed runs first, on the menus it was made for.
    if (message == WM_MENUS_WAITING) {
        if (wParam == 0) {
            PostMessageW(hwnd, WM_MENUS_WAITING, 1, 0);
        } else if (!isMenuOpen()) {
            for (auto &set : std::exchange(waiting, {})) set();
        }
        return 0;
    }
    // Windows tells the app's windows the system goes to sleep and wakes; one with Modern Standby may tell neither.
    if (message == WM_POWERBROADCAST && (wParam == PBT_APMSUSPEND || wParam == PBT_APMRESUMEAUTOMATIC)) {
        crossbind::app::postEvent(wParam == PBT_APMSUSPEND ? "suspend" : "resume", "null");
    }
    // webview sizes the window anew for a new scale, and Windows leaves it as it was for a new screen size: a window that
    // filled its screen fills it again.
    if (message == WM_DPICHANGED || message == WM_DISPLAYCHANGE) {
        const LRESULT result = CallWindowProcW(windowProcedure, hwnd, message, wParam, lParam);
        fitFullScreen();
        return result;
    }
    // The app ends with its window, and its icon would stay in the notification area until a pointer passed over it.
    if (message == WM_DESTROY) hideIcon();
    return CallWindowProcW(windowProcedure, hwnd, message, wParam, lParam);
}

void addItem(HMENU menu, const MenuItem &page, Built &into) {
    if (page.isSeparator) {
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        return;
    }
    if (page.isSubmenu) {
        HMENU submenu = CreatePopupMenu();
        if (!submenu) throw std::runtime_error("crossbind: the window's menus cannot be made: error " + std::to_string(GetLastError()));
        // In its menu first, which destroys it with itself.
        AppendMenuW(menu, MF_POPUP | MF_STRING, reinterpret_cast<UINT_PTR>(submenu), labelOf(page.label).c_str());
        for (const auto &child : page.items) addItem(submenu, child, into);
        return;
    }
    const UINT index = static_cast<UINT>(into.commands.size());
    std::wstring label = labelOf(page.label);
    std::wstring shortcut = page.accelerator ? shortcutText(*page.accelerator) : L"";
    bool isShortcut = page.accelerator.has_value();
    if (!page.role.empty()) {
        const auto role = ROLES.find(page.role);
        if (role == ROLES.end()) throw std::invalid_argument("crossbind: no menu item has the role " + page.role);
        if (page.label.empty()) label = role->second.label;
        // An editing role keeps the keys the webview does itself.
        if (role->second.editKey || !page.accelerator) shortcut = role->second.shortcut;
        isShortcut = isShortcut && !role->second.editKey;
        into.commands.push_back({"", page.role, false});
    } else {
        into.commands.push_back({page.id, "", page.checked.has_value()});
    }
    if (isShortcut) {
        const Accelerator &accelerator = *page.accelerator;
        into.shortcuts.push_back({keyOf(accelerator), accelerator.control, accelerator.alt, accelerator.shift, index});
    }
    if (!shortcut.empty()) label += L"\t" + shortcut;
    const UINT flags = MF_STRING | (page.isEnabled ? MF_ENABLED : MF_GRAYED) | (page.checked.value_or(false) ? MF_CHECKED : MF_UNCHECKED);
    AppendMenuW(menu, flags, FIRST_COMMAND + index, label.c_str());
}

// The page keeps the height app.window gives it, so the window takes the bar's height on, unless it is maximized or
// fills the screen, which takes its caption away.
void keepPageHeight(LONG pageHeight) {
    RECT client{};
    RECT frame{};
    const bool fillsScreen = !(GetWindowLongPtrW(window, GWL_STYLE) & WS_CAPTION);
    if (IsZoomed(window) || fillsScreen || !GetClientRect(window, &client) || !GetWindowRect(window, &frame)) return;
    const LONG grow = pageHeight - (client.bottom - client.top);
    if (grow == 0) return;
    SetWindowPos(window, nullptr, 0, 0, frame.right - frame.left, frame.bottom - frame.top + grow, SWP_NOZORDER | SWP_NOMOVE | SWP_NOACTIVATE);
}

// No menus take the bar away.
void setMenus(const std::vector<MenuItem> &menus, const MenuClicked &clicked, const std::function<void(Failure)> &done) {
    HMENU next = menus.empty() ? nullptr : CreateMenu();
    if (!menus.empty() && !next) {
        done("crossbind: the window's menus cannot be made: error " + std::to_string(GetLastError()));
        return;
    }
    Built nextBuilt;
    try {
        for (const auto &menu : menus) addItem(next, menu, nextBuilt);
    } catch (const std::exception &error) {
        DestroyMenu(next);
        done(std::string(error.what()));
        return;
    }
    RECT page{};
    GetClientRect(window, &page);
    if (!SetMenu(window, next)) {
        const DWORD error = GetLastError();
        if (next) DestroyMenu(next);
        done("crossbind: the window's menus cannot change: error " + std::to_string(error));
        return;
    }
    if (bar) DestroyMenu(bar);
    bar = next;
    built = std::move(nextBuilt);
    generation += 1;
    onClick = clicked;
    keepPageHeight(page.bottom - page.top);
    done(std::nullopt);
}

void balloonEnded() {
    balloons = std::max(balloons - 1, 0);
    if (!isTraySet && balloons == 0) hideIcon();
}

// Windows closes the menu as its user clicks elsewhere only while its window is in front, which a click of the icon
// lets it be, and opens the next only after a message of the window's. What the page sets meanwhile waits for it.
void openTrayMenu(int x, int y) {
    if (isTrayMenuOpen) return;
    SetForegroundWindow(trayWindow);
    isTrayMenuOpen = true;
    const auto command = static_cast<UINT>(TrackPopupMenu(trayMenu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON, x, y, 0, trayWindow, nullptr));
    isTrayMenuOpen = false;
    PostMessageW(trayWindow, WM_NULL, 0, 0);
    if (command >= FIRST_COMMAND) run(trayMenu, trayBuilt, command - FIRST_COMMAND);
    for (auto &set : std::exchange(trayWaiting, {})) set();
}

// A right click opens the tray's menu; any other click of the icon, or one without a menu, tells the page. An icon that
// shows for a notification alone tells nothing.
LRESULT CALLBACK trayProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_TRAY) {
        switch (LOWORD(lParam)) {
        case NIN_SELECT:
        case NIN_KEYSELECT:
            if (isTraySet) crossbind::app::postEvent("tray", "null");
            break;
        case WM_CONTEXTMENU:
            if (trayMenu) {
                openTrayMenu(GET_X_LPARAM(wParam), GET_Y_LPARAM(wParam));
            } else if (isTraySet) {
                crossbind::app::postEvent("tray", "null");
            }
            break;
        case NIN_BALLOONUSERCLICK:
            crossbind::app::postEvent("notification", "null");
            balloonEnded();
            break;
        case NIN_BALLOONTIMEOUT:
        case NIN_BALLOONHIDE:
            balloonEnded();
            break;
        default:
            break;
        }
        return 0;
    }
    if (taskbarCreated && message == taskbarCreated) {
        isIconShown = false;
        balloons = 0;
        if (isTraySet) showIcon();
        return 0;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

bool makeTrayWindow() {
    if (trayWindow) return true;
    WNDCLASSW type{};
    type.lpfnWndProc = trayProcedure;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = L"crossbind_tray";
    RegisterClassW(&type);
    trayWindow = CreateWindowExW(0, type.lpszClassName, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, type.hInstance, nullptr);
    if (!trayWindow) return false;
    taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
    // Explorer runs as its user, whose messages reach an app run as administrator only where it lets them.
    ChangeWindowMessageFilterEx(trayWindow, WM_TRAY, MSGFLT_ALLOW, nullptr);
    if (taskbarCreated) ChangeWindowMessageFilterEx(trayWindow, taskbarCreated, MSGFLT_ALLOW, nullptr);
    return true;
}

void setTrayNow(const TrayOptions &options, const MenuClicked &clicked, const std::function<void(Failure)> &done) {
    if (!makeTrayWindow()) {
        done("crossbind: the tray's window cannot be made: error " + std::to_string(GetLastError()));
        return;
    }
    HMENU next = options.menu.empty() ? nullptr : CreatePopupMenu();
    if (!options.menu.empty() && !next) {
        done("crossbind: the tray's menu cannot be made: error " + std::to_string(GetLastError()));
        return;
    }
    Built nextBuilt;
    try {
        for (const auto &item : options.menu) addItem(next, item, nextBuilt);
    } catch (const std::exception &error) {
        DestroyMenu(next);
        done(std::string(error.what()));
        return;
    }
    trayTip = wide(options.tooltip);
    NOTIFYICONDATAW data = iconData(0);
    if (!(isIconShown && Shell_NotifyIconW(NIM_MODIFY, &data)) && !showIcon()) {
        const std::string why = noNotificationArea();
        if (next) DestroyMenu(next);
        done(why);
        return;
    }
    if (trayMenu) DestroyMenu(trayMenu);
    trayMenu = next;
    trayBuilt = std::move(nextBuilt);
    onClick = clicked;
    isTraySet = true;
    done(std::nullopt);
}

// Taking the icon away would take a notification that shows from it, so the icon stays until the notification goes.
void removeTrayNow() {
    if (trayMenu) DestroyMenu(trayMenu);
    trayMenu = nullptr;
    trayBuilt = {};
    trayTip.clear();
    isTraySet = false;
    if (balloons == 0) {
        hideIcon();
        return;
    }
    NOTIFYICONDATAW data = iconData(0);
    Shell_NotifyIconW(NIM_MODIFY, &data);
}

}  // namespace

// The menus go on the top window, WebView2's own being a child of it. Its procedure takes their commands first, and the
// webview, which holds the keyboard, hands their accelerators over.
void setMenuWebView(void *webView) {
    controller = static_cast<ICoreWebView2Controller *>(webView);
    HWND host = nullptr;
    if (FAILED(controller->get_ParentWindow(&host)) || !host) return;
    window = GetAncestor(host, GA_ROOT);
    windowProcedure = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(menuProcedure)));
    auto *pressed = new Handler<ICoreWebView2AcceleratorKeyPressedEventHandler, ICoreWebView2Controller *, ICoreWebView2AcceleratorKeyPressedEventArgs *>(
        IID_ICoreWebView2AcceleratorKeyPressedEventHandler, [](ICoreWebView2Controller *, ICoreWebView2AcceleratorKeyPressedEventArgs *args) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind;
            UINT key = 0;
            COREWEBVIEW2_PHYSICAL_KEY_STATUS status{};
            if (FAILED(args->get_KeyEventKind(&kind)) || FAILED(args->get_VirtualKey(&key)) || FAILED(args->get_PhysicalKeyStatus(&status))) return S_OK;
            if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) return S_OK;
            const bool control = GetKeyState(VK_CONTROL) < 0;
            const bool alt = GetKeyState(VK_MENU) < 0;
            const bool shift = GetKeyState(VK_SHIFT) < 0;
            for (const auto &shortcut : built.shortcuts) {
                if (shortcut.key != key || shortcut.control != control || shortcut.alt != alt || shortcut.shift != shift) continue;
                // A held key repeats, which neither the page nor the menus take.
                args->put_Handled(TRUE);
                if (!status.WasKeyDown) PostMessageW(window, WM_SHORTCUT, shortcut.index, generation);
                break;
            }
            return S_OK;
        });
    EventRegistrationToken token;
    controller->add_AcceleratorKeyPressed(pressed, &token);
    pressed->Release();
}

// Menus set while one of the window's is open, or while others wait, wait for it to close, in order.
void setMenu(std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done) {
    onMainThread([menus = std::move(menus), clicked = std::move(clicked), done = std::move(done)] {
        if (!window) {
            done("crossbind: the app has no window to show its menus in");
            return;
        }
        if (isMenuOpen() || !waiting.empty()) {
            waiting.push_back([menus, clicked, done] { setMenus(menus, clicked, done); });
            return;
        }
        setMenus(menus, clicked, done);
    });
}

void setTray(TrayOptions options, MenuClicked clicked, std::function<void(Failure)> done) {
    onMainThread([options = std::move(options), clicked = std::move(clicked), done = std::move(done)] {
        if (isTrayMenuOpen) {
            trayWaiting.push_back([options, clicked, done] { setTrayNow(options, clicked, done); });
            return;
        }
        setTrayNow(options, clicked, done);
    });
}

void removeTray(std::function<void(Failure)> done) {
    onMainThread([done = std::move(done)] {
        auto remove = [done] {
            removeTrayNow();
            done(std::nullopt);
        };
        if (isTrayMenuOpen) {
            trayWaiting.push_back(remove);
        } else {
            remove();
        }
    });
}

// A balloon of the tray's icon, which Windows 10 and later show as a notification of theirs. Without the page's tray, an
// icon of the app's shows until the notification goes.
void showNotification(Notification notification, std::function<void(Failure)> done) {
    onMainThread([notification = std::move(notification), done = std::move(done)] {
        if (!makeTrayWindow()) {
            done("crossbind: the tray's window cannot be made: error " + std::to_string(GetLastError()));
            return;
        }
        if (!isIconShown && !showIcon()) {
            done(noNotificationArea());
            return;
        }
        static const HICON icon = iconAt(SM_CXICON);
        NOTIFYICONDATAW data = iconData(NIF_INFO);
        // A balloon without a text goes away.
        const bool hasBody = !notification.body.empty();
        copyText(data.szInfoTitle, hasBody ? wide(notification.title) : std::wstring());
        copyText(data.szInfo, wide(hasBody ? notification.body : notification.title));
        data.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON;
        data.hBalloonIcon = icon;
        if (!Shell_NotifyIconW(NIM_MODIFY, &data)) {
            if (!isTraySet && balloons == 0) hideIcon();
            done("crossbind: Windows did not show the notification");
            return;
        }
        balloons += 1;
        done(std::nullopt);
    });
}

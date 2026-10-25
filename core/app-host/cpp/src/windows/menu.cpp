#include "host_core.h"
#include "platform.h"
#include "windows/com.h"

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

void run(UINT index) {
    const UINT command = FIRST_COMMAND + index;
    if (index >= built.commands.size() || (GetMenuState(bar, command, MF_BYCOMMAND) & (MF_GRAYED | MF_DISABLED))) return;
    const Command &item = built.commands[index];
    if (!item.role.empty()) {
        runRole(item.role);
        return;
    }
    std::optional<bool> checked;
    if (item.isCheck) {
        checked = !(GetMenuState(bar, command, MF_BYCOMMAND) & MF_CHECKED);
        CheckMenuItem(bar, command, MF_BYCOMMAND | (*checked ? MF_CHECKED : MF_UNCHECKED));
    }
    if (onClick && !item.id.empty()) onClick(item.id, checked);
}

LRESULT CALLBACK menuProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_COMMAND && HIWORD(wParam) == 0 && lParam == 0 && LOWORD(wParam) >= FIRST_COMMAND) {
        run(LOWORD(wParam) - FIRST_COMMAND);
        return 0;
    }
    if (message == WM_SHORTCUT) {
        if (lParam == generation) run(static_cast<UINT>(wParam));
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

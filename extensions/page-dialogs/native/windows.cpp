#include "dialogs.h"

#include <windows.h>
#include <commctrl.h>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

using crossbind::PageDialog;

namespace {

constexpr WORD MESSAGE_ID = 100;
constexpr WORD TEXT_ID = 101;
// A prompt's layout in dialog units, which Windows scales with the window's font and DPI.
constexpr short WIDTH = 260;
constexpr short MARGIN = 7;
constexpr short LINE = 8;
constexpr short EDIT_HEIGHT = 14;
constexpr short BUTTON_WIDTH = 50;
constexpr short BUTTON_HEIGHT = 14;

std::wstring wide(const std::string &text) {
    const int length = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), length);
    return out;
}

std::string utf8(const std::wstring &text) {
    const int length = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), length, nullptr, nullptr);
    return out;
}

// An alert or a confirm as the system's task dialog, modal to the page's window, as a message box is.
bool confirmed(const PageDialog &dialog) {
    const std::wstring title = wide(crossbind::appName());
    const std::wstring message = wide(dialog.message());
    TASKDIALOGCONFIG config{};
    config.cbSize = sizeof config;
    config.hwndParent = static_cast<HWND>(windowOf(dialog));
    // Escape and closing the dialog answer IDCANCEL.
    config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW;
    config.dwCommonButtons = dialog.kind() == PageDialog::Kind::alert ? TDCBF_OK_BUTTON : TDCBF_OK_BUTTON | TDCBF_CANCEL_BUTTON;
    config.pszWindowTitle = title.c_str();
    config.pszContent = message.c_str();
    int clicked = IDCANCEL;
    return SUCCEEDED(TaskDialogIndirect(&config, &clicked, nullptr, nullptr)) && clicked == IDOK;
}

// A dialog template in memory, as a resource file would hold it: words, a string after each item's class, and each item
// on a 4-byte boundary.
class Template {
public:
    void word(WORD value) { words_.push_back(value); }
    void dword(DWORD value) {
        word(LOWORD(value));
        word(HIWORD(value));
    }
    void text(const wchar_t *value) {
        for (; *value; ++value) word(*value);
        word(0);
    }
    void align() {
        if (words_.size() % 2) word(0);
    }
    void item(DWORD style, short x, short y, short cx, short cy, WORD id, WORD atom, const wchar_t *title) {
        align();
        dword(style | WS_CHILD | WS_VISIBLE);
        dword(0);
        for (const short value : {x, y, cx, cy}) word(static_cast<WORD>(value));
        word(id);
        word(0xFFFF);
        word(atom);
        text(title);
        word(0);
    }
    const DLGTEMPLATE *data() const { return reinterpret_cast<const DLGTEMPLATE *>(words_.data()); }

private:
    std::vector<WORD> words_;
};

struct Prompt {
    std::wstring message;
    std::wstring text;
    bool isAnswered = false;
};

// Grows the message to the lines its text takes, as far as the screen lets it, with the text box and the buttons below
// it, and centers the prompt on the app's window, as the task dialog is.
void fit(HWND box) {
    HWND message = GetDlgItem(box, MESSAGE_ID);
    RECT area{};
    GetWindowRect(message, &area);
    const int width = area.right - area.left;
    const int length = GetWindowTextLengthW(message);
    std::wstring text(static_cast<size_t>(length) + 1, L'\0');
    GetWindowTextW(message, text.data(), length + 1);
    HDC dc = GetDC(message);
    HGDIOBJ font = SelectObject(dc, reinterpret_cast<HFONT>(SendMessageW(box, WM_GETFONT, 0, 0)));
    RECT needed{0, 0, width, 0};
    DrawTextW(dc, text.c_str(), length, &needed, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX);
    SelectObject(dc, font);
    ReleaseDC(message, dc);
    RECT frame{};
    GetWindowRect(box, &frame);
    MONITORINFO monitor{};
    monitor.cbSize = sizeof monitor;
    GetMonitorInfoW(MonitorFromWindow(box, MONITOR_DEFAULTTONEAREST), &monitor);
    const RECT &work = monitor.rcWork;
    const LONG room = std::max(0L, (work.bottom - work.top) - (frame.bottom - frame.top));
    const LONG grow = std::clamp((needed.bottom - needed.top) - (area.bottom - area.top), 0L, room);
    if (grow > 0) {
        SetWindowPos(message, nullptr, 0, 0, width, area.bottom - area.top + grow, SWP_NOMOVE | SWP_NOZORDER);
        for (const int id : {static_cast<int>(TEXT_ID), IDOK, IDCANCEL}) {
            HWND child = GetDlgItem(box, id);
            RECT place{};
            GetWindowRect(child, &place);
            POINT at{place.left, place.top};
            ScreenToClient(box, &at);
            SetWindowPos(child, nullptr, at.x, at.y + grow, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
        }
    }
    const LONG boxWidth = frame.right - frame.left;
    const LONG boxHeight = frame.bottom - frame.top + grow;
    RECT over = work;
    if (HWND owner = GetWindow(box, GW_OWNER)) GetWindowRect(owner, &over);
    const LONG x = std::clamp((over.left + over.right - boxWidth) / 2, work.left, std::max(work.left, work.right - boxWidth));
    const LONG y = std::clamp((over.top + over.bottom - boxHeight) / 2, work.top, std::max(work.top, work.bottom - boxHeight));
    SetWindowPos(box, nullptr, x, y, boxWidth, boxHeight, SWP_NOZORDER);
}

INT_PTR CALLBACK promptProc(HWND box, UINT message, WPARAM w, LPARAM l) {
    auto *prompt = reinterpret_cast<Prompt *>(GetWindowLongPtrW(box, DWLP_USER));
    switch (message) {
    case WM_INITDIALOG:
        SetWindowLongPtrW(box, DWLP_USER, l);
        prompt = reinterpret_cast<Prompt *>(l);
        SetWindowTextW(box, wide(crossbind::appName()).c_str());
        SetDlgItemTextW(box, MESSAGE_ID, prompt->message.c_str());
        SetDlgItemTextW(box, TEXT_ID, prompt->text.c_str());
        fit(box);
        SendDlgItemMessageW(box, TEXT_ID, EM_SETSEL, 0, -1);
        SetFocus(GetDlgItem(box, TEXT_ID));
        // The text box has the focus.
        return FALSE;
    case WM_COMMAND:
        if (LOWORD(w) == IDOK) {
            HWND edit = GetDlgItem(box, TEXT_ID);
            const int length = GetWindowTextLengthW(edit);
            std::wstring text(static_cast<size_t>(length) + 1, L'\0');
            GetWindowTextW(edit, text.data(), length + 1);
            text.resize(static_cast<size_t>(length));
            prompt->text = std::move(text);
            prompt->isAnswered = true;
            EndDialog(box, IDOK);
            return TRUE;
        }
        if (LOWORD(w) == IDCANCEL) {
            EndDialog(box, IDCANCEL);
            return TRUE;
        }
        return FALSE;
    default:
        return FALSE;
    }
}

// A prompt as a dialog of the system's controls, which Windows has no ready one of: its message, a text box with the
// prompt's text, and OK and Cancel, in the task dialog's font. Enter is OK and Escape is Cancel.
std::optional<std::string> prompted(const PageDialog &dialog) {
    constexpr short TEXT_Y = MARGIN + 2 * LINE + 4;
    constexpr short BUTTONS_Y = TEXT_Y + EDIT_HEIGHT + MARGIN;
    constexpr short HEIGHT = BUTTONS_Y + BUTTON_HEIGHT + MARGIN;
    Template layout;
    layout.dword(DS_MODALFRAME | DS_SETFONT | DS_CENTER | WS_POPUP | WS_CAPTION | WS_SYSMENU);
    layout.dword(0);
    layout.word(4);
    for (const short value : {short(0), short(0), WIDTH, HEIGHT}) layout.word(static_cast<WORD>(value));
    layout.word(0);
    layout.word(0);
    layout.text(L"");
    layout.word(9);
    layout.text(L"Segoe UI");
    layout.item(SS_LEFT | SS_NOPREFIX, MARGIN, MARGIN, WIDTH - 2 * MARGIN, 2 * LINE, MESSAGE_ID, 0x0082, L"");
    layout.item(ES_AUTOHSCROLL | WS_BORDER | WS_TABSTOP, MARGIN, TEXT_Y, WIDTH - 2 * MARGIN, EDIT_HEIGHT, TEXT_ID, 0x0081, L"");
    layout.item(BS_DEFPUSHBUTTON | WS_TABSTOP, WIDTH - MARGIN - 2 * BUTTON_WIDTH - 4, BUTTONS_Y, BUTTON_WIDTH, BUTTON_HEIGHT, IDOK, 0x0080, L"OK");
    layout.item(BS_PUSHBUTTON | WS_TABSTOP, WIDTH - MARGIN - BUTTON_WIDTH, BUTTONS_Y, BUTTON_WIDTH, BUTTON_HEIGHT, IDCANCEL, 0x0080, L"Cancel");
    Prompt prompt{wide(dialog.message()), wide(dialog.defaultText())};
    DialogBoxIndirectParamW(GetModuleHandleW(nullptr), layout.data(), static_cast<HWND>(windowOf(dialog)), promptProc, reinterpret_cast<LPARAM>(&prompt));
    if (!prompt.isAnswered) return std::nullopt;
    return utf8(prompt.text);
}

}  // namespace

// Each modal to the app's window, as the host hands it over once the webview's event that asked has returned.
void showPageDialog(PageDialog dialog) {
    if (dialog.kind() != PageDialog::Kind::prompt) {
        if (confirmed(dialog)) dialog.accept();
        else dialog.cancel();
        return;
    }
    const std::optional<std::string> text = prompted(dialog);
    if (text) dialog.accept(*text);
    else dialog.cancel();
}

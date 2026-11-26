// The preview's indicator as its user sees it on Windows: the app window's title and the items at the top of its system
// menu, each with its words and whether it takes a click; an item of it pressed as a click on it sends its command;
// whether the window takes its user's input, which a message dialog or a question of its own takes from it; and whether
// it keeps its title bar, which a window that fills the screen for its page has not.
#include "crossbind/extension.h"

#include <windows.h>

#include <chrono>
#include <string>
#include <thread>

namespace {

using crossbind::Call;
using crossbind::Value;

constexpr int MOST_CHARACTERS = 512;

std::string narrow(const wchar_t *text, int length) {
    if (length <= 0) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, text, length, nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, length, out.data(), size, nullptr, nullptr);
    return out;
}

// The system menu's items in order: each one's words, as a menu draws them, whether it takes a click and its command.
Value::Array itemsOf(HMENU menu) {
    Value::Array items;
    for (int at = 0; menu && at < GetMenuItemCount(menu); at += 1) {
        wchar_t text[MOST_CHARACTERS] = {};
        MENUITEMINFOW item{};
        item.cbSize = sizeof item;
        item.fMask = MIIM_FTYPE | MIIM_STATE | MIIM_ID | MIIM_STRING;
        item.dwTypeData = text;
        item.cch = MOST_CHARACTERS;
        if (!GetMenuItemInfoW(menu, static_cast<UINT>(at), TRUE, &item)) continue;
        if (item.fType & MFT_SEPARATOR) {
            items.emplace_back(Value::Object{{"separator", true}});
            continue;
        }
        std::string words = narrow(text, static_cast<int>(item.cch));
        for (std::size_t mark = words.find("&&"); mark != std::string::npos; mark = words.find("&&", mark + 1)) words.erase(mark, 1);
        items.emplace_back(Value::Object{{"words", words}, {"enabled", (item.fState & MFS_DISABLED) == 0}, {"command", static_cast<double>(item.wID)}});
    }
    return items;
}

}  // namespace

Value indicatorState() {
    HWND window = static_cast<HWND>(crossbind::appWindow());
    wchar_t title[MOST_CHARACTERS] = {};
    const int length = window ? GetWindowTextW(window, title, MOST_CHARACTERS) : 0;
    const Value::Array items = itemsOf(window ? GetSystemMenu(window, FALSE) : nullptr);
    bool isUp = false;
    for (const Value &item : items) isUp = isUp || item["words"].asString("") == "Close preview";
    // A window that fills the screen for its page is a popup without its title bar.
    const bool isFramed = window && (GetWindowLongPtrW(window, GWL_STYLE) & WS_CAPTION) == WS_CAPTION;
    return Value::Object{{"up", isUp}, {"title", narrow(title, length)}, {"items", items}, {"takesInput", window && IsWindowEnabled(window)}, {"framed", isFramed}};
}

void indicatorUp(Call call) {
    crossbind::onMainThread([call] { call.resolve(indicatorState()); });
}

// The item's command sent now, or once ms passed, the call answered first, as when the press will reload or end the
// page that asked.
void pressIndicator(Call call) {
    const std::string words = call.options()["item"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    const auto press = [words]() -> bool {
        HWND window = static_cast<HWND>(crossbind::appWindow());
        for (const Value &item : itemsOf(window ? GetSystemMenu(window, FALSE) : nullptr)) {
            if (item["words"].asString("") != words || !item["enabled"].asBool(false)) continue;
            PostMessageW(window, WM_SYSCOMMAND, static_cast<WPARAM>(item["command"].asNumber()), 0);
            return true;
        }
        return false;
    };
    if (ms > 0) {
        call.resolve();
        std::thread([press, ms] {
            std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(ms)));
            crossbind::onMainThread([press] { press(); });
        }).detach();
        return;
    }
    crossbind::onMainThread([call, press, words] {
        if (press()) call.resolve();
        else call.reject("crossbind e2e: the window's system menu has no item " + words + " to press");
    });
}

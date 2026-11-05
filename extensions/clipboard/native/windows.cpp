#include "clipboard.h"

#include <windows.h>

#include <cstring>

namespace crossbind::clipboard {
namespace {

// Another app may hold the clipboard for a moment, as a clipboard manager does after each copy.
constexpr int OPEN_ATTEMPTS = 5;
constexpr DWORD OPEN_WAIT_MS = 5;

std::wstring wide(const std::string &text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
    return result;
}

std::string utf8(const wchar_t *text) {
    if (!text || !*text) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string result(static_cast<size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), size, nullptr, nullptr);
    return result;
}

// The window owns what the app puts on the clipboard.
bool openClipboard() {
    for (int attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
        if (OpenClipboard(static_cast<HWND>(appWindow()))) return true;
        Sleep(OPEN_WAIT_MS);
    }
    return false;
}

// UTF-16 with its null, in memory the clipboard owns once it takes it.
HGLOBAL memoryOf(const std::wstring &text) {
    const size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    void *at = memory ? GlobalLock(memory) : nullptr;
    if (!at) {
        if (memory) GlobalFree(memory);
        return nullptr;
    }
    std::memcpy(at, text.c_str(), bytes);
    GlobalUnlock(memory);
    return memory;
}

}  // namespace

void readText(Call call) {
    onMainThread([call] {
        if (!openClipboard()) {
            call.reject("crossbind: another app holds the clipboard");
            return;
        }
        std::string text;
        if (HANDLE data = GetClipboardData(CF_UNICODETEXT)) {
            if (const auto *chars = static_cast<const wchar_t *>(GlobalLock(data))) {
                text = utf8(chars);
                GlobalUnlock(data);
            }
        }
        CloseClipboard();
        call.resolve(text);
    });
}

void writeText(Call call, std::string text) {
    onMainThread([call, text] {
        HGLOBAL memory = memoryOf(wide(text));
        if (!memory) {
            call.reject("crossbind: no memory for the clipboard's text");
            return;
        }
        if (!openClipboard()) {
            GlobalFree(memory);
            call.reject("crossbind: another app holds the clipboard");
            return;
        }
        EmptyClipboard();
        const bool isTaken = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
        CloseClipboard();
        if (!isTaken) {
            GlobalFree(memory);
            call.reject("crossbind: the clipboard took no text");
            return;
        }
        call.resolve();
    });
}

}  // namespace crossbind::clipboard

#include "windows/com.h"

#include <shellapi.h>

#include <algorithm>
#include <cstring>
#include <deque>
#include <mutex>

namespace crossbind::windows {

namespace {

constexpr UINT RUN = WM_APP + 1;
std::atomic<DWORD> uiThread{0};
// Set once, under queueMutex, which other threads read it under.
HWND dispatcher = nullptr;
std::mutex queueMutex;
std::deque<std::function<void()>> queue;

LRESULT CALLBACK dispatch(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message != RUN) return DefWindowProcW(window, message, wParam, lParam);
    std::deque<std::function<void()>> tasks;
    {
        std::lock_guard<std::mutex> lock(queueMutex);
        tasks.swap(queue);
    }
    for (auto &task : tasks) task();
    return 0;
}

// A message-only window of the UI thread, whose message loop runs what other threads post to it.
void startDispatcher() {
    uiThread = GetCurrentThreadId();
    WNDCLASSW type{};
    type.lpfnWndProc = dispatch;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = L"crossbind_dispatcher";
    RegisterClassW(&type);
    HWND window = CreateWindowExW(0, type.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, type.hInstance, nullptr);
    // The module's code can post before the window exists; what it posted runs now.
    std::lock_guard<std::mutex> lock(queueMutex);
    dispatcher = window;
    if (!queue.empty()) PostMessageW(dispatcher, RUN, 0, 0);
}

}  // namespace

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

std::wstring executablePath() {
    std::wstring path(MAX_PATH, L'\0');
    for (;;) {
        const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
        if (length < path.size()) {
            path.resize(length);
            return path;
        }
        path.resize(path.size() * 2);
    }
}

std::string take(LPWSTR text) {
    std::string result = utf8(text);
    CoTaskMemFree(text);
    return result;
}

LPWSTR give(const std::wstring &text) {
    auto *copy = static_cast<LPWSTR>(CoTaskMemAlloc((text.size() + 1) * sizeof(wchar_t)));
    if (copy) std::memcpy(copy, text.c_str(), (text.size() + 1) * sizeof(wchar_t));
    return copy;
}

// The platform's calls all start here, on the UI thread, before any other thread posts to it.
ICoreWebView2 *coreWebView(void *controller) {
    if (!dispatcher) startDispatcher();
    ICoreWebView2 *core = nullptr;
    static_cast<ICoreWebView2Controller *>(controller)->get_CoreWebView2(&core);
    return core;
}

// What other threads post waits in one queue, which one message drains: Windows caps the messages a thread has posted.
void onMainThread(std::function<void()> fn) {
    if (GetCurrentThreadId() == uiThread) {
        fn();
        return;
    }
    std::lock_guard<std::mutex> lock(queueMutex);
    const bool isIdle = queue.empty();
    queue.push_back(std::move(fn));
    if (isIdle && dispatcher) PostMessageW(dispatcher, RUN, 0, 0);
}

bool openOutside(const std::string &uri) {
    std::string scheme = uri.substr(0, uri.find(':'));
    // ASCII alone, whatever the locale.
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; });
    if (scheme != "http" && scheme != "https" && scheme != "mailto") return false;
    // The URL goes into the command line of its scheme's handler, where a quote or a space would split it.
    if (std::any_of(uri.begin(), uri.end(), [](unsigned char c) { return c <= ' ' || c == '"' || c == 0x7f; })) return false;
    return reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide(uri).c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32;
}

}  // namespace crossbind::windows

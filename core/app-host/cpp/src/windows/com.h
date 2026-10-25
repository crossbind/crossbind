#pragma once

// What the Windows host needs of COM without WRL's implementations, which llvm-mingw lacks: WebView2's events as
// functions, its UTF-16 strings, and the UI thread.
#include <windows.h>

#include "WebView2.h"

#include <atomic>
#include <functional>
#include <string>
#include <utility>

namespace crossbind::windows {

// One WebView2 event or completion as a function.
template <typename Interface, typename... Args>
class Handler final : public Interface {
public:
    Handler(REFIID iid, std::function<HRESULT(Args...)> fn) : iid_(iid), fn_(std::move(fn)) {}

    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!out) return E_POINTER;
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, iid_)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<Interface *>(this);
        AddRef();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Invoke(Args... args) override { return fn_(args...); }

private:
    std::atomic<ULONG> refs_{1};
    IID iid_;
    std::function<HRESULT(Args...)> fn_;
};

std::wstring wide(const std::string &text);
std::string utf8(const wchar_t *text);
// The app's executable, however long its path.
std::wstring executablePath();
// A string WebView2 hands out, which the caller owns.
std::string take(LPWSTR text);
// A copy WebView2 takes ownership of.
LPWSTR give(const std::wstring &text);
// The webview of the controller main() gets from webview.
ICoreWebView2 *coreWebView(void *controller);
// Runs fn on the UI thread: at once when the caller is on it, else when the thread's message loop gets to it.
void onMainThread(std::function<void()> fn);
// An http, https or mailto address in the default browser or mail app; false when it is none or nothing opened it.
bool openOutside(const std::string &uri);

}  // namespace crossbind::windows

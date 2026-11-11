#include "feel.h"

#include <windows.h>

#include "WebView2.h"

#include <cstring>
#include <memory>
#include <string>

namespace crossbind::pagefeel {
namespace {

class ScriptAdded final : public ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler {
public:
    explicit ScriptAdded(std::shared_ptr<bool> isAdded) : isAdded_(std::move(isAdded)) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, IID_ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler *>(this);
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references_); }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = InterlockedDecrement(&references_);
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT, LPCWSTR) override {
        *isAdded_ = true;
        return S_OK;
    }

private:
    std::shared_ptr<bool> isAdded_;
    LONG references_ = 1;
};

// WebView2 adds a script later; the UI thread waits for it, as the host does for its own, so the first page gets it.
void addScript(ICoreWebView2 *core) {
    const std::wstring source(PAGE_SCRIPT, PAGE_SCRIPT + std::strlen(PAGE_SCRIPT));
    auto isAdded = std::make_shared<bool>(false);
    auto *done = new ScriptAdded(isAdded);
    if (SUCCEEDED(core->AddScriptToExecuteOnDocumentCreated(source.c_str(), done))) {
        MSG message;
        while (!*isAdded) {
            const BOOL got = GetMessageW(&message, nullptr, 0, 0);
            // The window closed meanwhile: the app's own loop gets the quit as well.
            if (got == 0) PostQuitMessage(static_cast<int>(message.wParam));
            if (got <= 0) break;
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    done->Release();
}

template <typename Newer>
void withSettings(ICoreWebView2Settings *settings, REFIID id, void (*change)(Newer *)) {
    Newer *newer = nullptr;
    if (FAILED(settings->QueryInterface(id, reinterpret_cast<void **>(&newer)))) return;
    change(newer);
    newer->Release();
}

void turnOffWhatABrowserHas(ICoreWebView2 *core) {
    ICoreWebView2Settings *settings = nullptr;
    if (FAILED(core->get_Settings(&settings))) return;
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    withSettings<ICoreWebView2Settings5>(settings, IID_ICoreWebView2Settings5, [](ICoreWebView2Settings5 *newer) { newer->put_IsPinchZoomEnabled(FALSE); });
    withSettings<ICoreWebView2Settings6>(settings, IID_ICoreWebView2Settings6, [](ICoreWebView2Settings6 *newer) { newer->put_IsSwipeNavigationEnabled(FALSE); });
    withSettings<ICoreWebView2Settings4>(settings, IID_ICoreWebView2Settings4, [](ICoreWebView2Settings4 *newer) { newer->put_IsGeneralAutofillEnabled(FALSE); });
#ifndef CROSSBIND_APP_DEV
    // Reload, find, print and the rest; a build for its developer keeps them, with DevTools' F12.
    withSettings<ICoreWebView2Settings3>(settings, IID_ICoreWebView2Settings3, [](ICoreWebView2Settings3 *newer) { newer->put_AreBrowserAcceleratorKeysEnabled(FALSE); });
#endif
    settings->Release();
}

}  // namespace

void configure(void *webView) {
    ICoreWebView2 *core = nullptr;
    if (FAILED(static_cast<ICoreWebView2Controller *>(webView)->get_CoreWebView2(&core))) return;
    turnOffWhatABrowserHas(core);
    addScript(core);
    core->Release();
}

}  // namespace crossbind::pagefeel

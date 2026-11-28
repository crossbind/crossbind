// The preview's indicator as its user sees it on Windows: the app window's title and the items at the top of its system
// menu, each with its words and whether it takes a click; an item of it pressed as a click on it sends its command;
// whether the window takes its user's input, which a message dialog or a question of its own takes from it; and whether
// it keeps its title bar, which a window that fills the screen for its page has not; and each request for a served
// origin's first page that WebView2 hands the host, noted at the run's endpoint with what asked it.
#include "crossbind/extension.h"

#include <windows.h>

#include "WebView2.h"

#include <chrono>
#include <cstdint>
#include <cwchar>
#include <optional>
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

// The system menu's items in order: each one's words, as a menu draws them, whether it takes a click, bears a check
// mark, its command, and a submenu's own items.
Value::Array itemsOf(HMENU menu) {
    Value::Array items;
    for (int at = 0; menu && at < GetMenuItemCount(menu); at += 1) {
        wchar_t text[MOST_CHARACTERS] = {};
        MENUITEMINFOW item{};
        item.cbSize = sizeof item;
        item.fMask = MIIM_FTYPE | MIIM_STATE | MIIM_ID | MIIM_STRING | MIIM_SUBMENU;
        item.dwTypeData = text;
        item.cch = MOST_CHARACTERS;
        if (!GetMenuItemInfoW(menu, static_cast<UINT>(at), TRUE, &item)) continue;
        if (item.fType & MFT_SEPARATOR) {
            items.emplace_back(Value::Object{{"separator", true}});
            continue;
        }
        std::string words = narrow(text, static_cast<int>(item.cch));
        for (std::size_t mark = words.find("&&"); mark != std::string::npos; mark = words.find("&&", mark + 1)) words.erase(mark, 1);
        Value::Object each{{"words", words}, {"enabled", (item.fState & MFS_DISABLED) == 0}, {"checked", (item.fState & MFS_CHECKED) != 0},
            {"command", static_cast<double>(item.wID)}};
        if (item.hSubMenu) each.emplace_back("items", itemsOf(item.hSubMenu));
        items.emplace_back(std::move(each));
    }
    return items;
}

// The enabled item of these words, in the menu or in a submenu of it, that sends a command.
const Value *itemOf(const Value::Array &items, const std::string &words) {
    for (const Value &item : items) {
        if (item["words"].asString("") == words && item["enabled"].asBool(false) && item["items"].isNull()) return &item;
        if (const Value *inner = item["items"].isArray() ? itemOf(item["items"].asArray(), words) : nullptr) return inner;
    }
    return nullptr;
}

// Whether a URL is the first page of an origin an extension serves, http://<name>.localhost/.
bool isFirstPage(const std::string &url) {
    const std::string scheme = "http://";
    const std::string suffix = ".localhost";
    const std::size_t path = url.rfind(scheme, 0) == 0 ? url.find('/', scheme.size()) : std::string::npos;
    if (path == std::string::npos || path < scheme.size() + suffix.size() || url.compare(path - suffix.size(), suffix.size(), suffix) != 0) return false;
    return path + 1 == url.size() || url[path + 1] == '?' || url[path + 1] == '#';
}

std::string sourceOf(COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS kind) {
    if (kind == COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT) return "document";
    if (kind == COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER) return "shared worker";
    if (kind == COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER) return "service worker";
    return "unknown";
}

// Each request for a served origin's first page that WebView2 hands the host, which it reads and leaves unanswered.
class FirstPages final : public ICoreWebView2WebResourceRequestedEventHandler {
public:
    FirstPages(std::string endpoint, uint64_t window) : endpoint_(std::move(endpoint)), window_(window) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, IID_ICoreWebView2WebResourceRequestedEventHandler)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<ICoreWebView2WebResourceRequestedEventHandler *>(this);
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references_); }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = InterlockedDecrement(&references_);
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2 *, ICoreWebView2WebResourceRequestedEventArgs *args) override {
        ICoreWebView2WebResourceRequest *request = nullptr;
        if (FAILED(args->get_Request(&request)) || !request) return S_OK;
        LPWSTR uri = nullptr;
        const HRESULT read = request->get_Uri(&uri);
        request->Release();
        if (FAILED(read) || !uri) return S_OK;
        const std::string url = narrow(uri, static_cast<int>(std::wcslen(uri)));
        CoTaskMemFree(uri);
        if (!isFirstPage(url)) return S_OK;
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS kind{};
        ICoreWebView2WebResourceRequestedEventArgs2 *more = nullptr;
        if (SUCCEEDED(args->QueryInterface(IID_ICoreWebView2WebResourceRequestedEventArgs2, reinterpret_cast<void **>(&more))) && more) {
            more->get_RequestedSourceKind(&kind);
            more->Release();
        }
        const std::string body =
            Value(Value::Object{{"event", std::string("handed")}, {"window", static_cast<double>(window_)}, {"url", url}, {"source", sourceOf(kind)}}).json();
        crossbind::fetch("POST", endpoint_ + "/report?role=app", {{"Content-Type", "application/json"}}, body, [](std::optional<std::string>, crossbind::FetchResponse) {});
        return S_OK;
    }

private:
    std::string endpoint_;
    uint64_t window_;
    LONG references_ = 1;
};

}  // namespace

void noteFirstPages(const std::string &endpoint, const crossbind::Window &window) {
    ICoreWebView2 *core = nullptr;
    if (!window.webView() || FAILED(static_cast<ICoreWebView2Controller *>(window.webView())->get_CoreWebView2(&core)) || !core) return;
    auto *heard = new FirstPages(endpoint, window.id());
    EventRegistrationToken token;
    core->add_WebResourceRequested(heard, &token);
    heard->Release();
    core->Release();
}

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
        const Value::Array items = itemsOf(window ? GetSystemMenu(window, FALSE) : nullptr);
        const Value *item = itemOf(items, words);
        if (!item) return false;
        PostMessageW(window, WM_SYSCOMMAND, static_cast<WPARAM>((*item)["command"].asNumber()), 0);
        return true;
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

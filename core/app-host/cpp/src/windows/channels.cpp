#include "platform.h"
#include "windows/com.h"

// crossbind's windows image writes it beside the SDK's headers.
#include "crossbind_webview2.h"

#include <shlwapi.h>

#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>

using namespace crossbind::windows;

namespace {

// The runtime the app declares itself compatible with, as the SDK's own options do: the one of the SDK it builds with.
constexpr const wchar_t *TARGET_VERSION = CROSSBIND_WEBVIEW2_TARGET_VERSION;

// WebView2's page messages answer nothing, so the page side of WebKit's reply channels is this script: a message
// carries its channel's name and an id, and the reply comes back with the id. The host hears the top frame alone. An id
// names its document too, so a reply meant for the page before a reload answers nothing in the next one.
constexpr const char *CHANNELS_SCRIPT = R"js((() => {
  const pending = new Map();
  const session = crypto.getRandomValues(new Uint32Array(2)).join('-');
  let next = 0;
  const handlers = {};
  Object.defineProperty(globalThis, 'webkit', { value: { messageHandlers: handlers } });
  Object.defineProperty(globalThis, '__crossbind_channel', { value: (name) => {
    handlers[name] = {
      postMessage: (text) => new Promise((resolve) => {
        const id = `${session}.${++next}`;
        pending.set(id, resolve);
        chrome.webview.postMessage(`${name}\n${id}\n${text}`);
      }),
    };
  } });
  chrome.webview.addEventListener('message', (event) => {
    const text = String(event.data);
    const cut = text.indexOf('\n');
    const id = text.slice(0, cut);
    pending.get(id)?.(text.slice(cut + 1));
    pending.delete(id);
  });
})();)js";

// Wraps the page's console and reports uncaught errors.
constexpr const char *CONSOLE_SCRIPT = R"js((() => {
  const text = (args) => args.map((arg) => {
    if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(' ');
  const post = (level, args) => chrome.webview.postMessage(`crossbind_console\n0\n${level}\n${text(args)}`);
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { post(level, args); original(...args); };
  }
  addEventListener('error', (event) => post('error', [event.error ?? event.message]));
  addEventListener('unhandledrejection', (event) => post('error', [event.reason]));
})();)js";

std::map<std::string, MessageHandler> &handlers() {
    static auto *all = new std::map<std::string, MessageHandler>();
    return *all;
}

std::string originOf(const std::string &url) {
    const auto scheme = url.find("://");
    if (scheme == std::string::npos) return url;
    return url.substr(0, url.find_first_of("/?#", scheme + 3));
}

// WebView2 adds a script later; the UI thread waits for it, as webview's own scripts do, so the first page gets it.
void addScript(ICoreWebView2 *core, const std::string &source) {
    auto added = std::make_shared<bool>(false);
    auto *done = new Handler<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, HRESULT, LPCWSTR>(
        IID_ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, [added](HRESULT, LPCWSTR) -> HRESULT {
            *added = true;
            return S_OK;
        });
    if (SUCCEEDED(core->AddScriptToExecuteOnDocumentCreated(wide("if (window === window.top) {\n" + source + "\n}").c_str(), done))) {
        MSG message;
        while (!*added) {
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

void listen(ICoreWebView2 *core) {
    static bool listening = false;
    if (listening) return;
    listening = true;
    addScript(core, CHANNELS_SCRIPT);
    auto *received = new Handler<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *>(
        IID_ICoreWebView2WebMessageReceivedEventHandler, [core](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
            LPWSTR raw = nullptr;
            if (FAILED(args->TryGetWebMessageAsString(&raw))) return S_OK;
            const std::string text = take(raw);
            const size_t first = text.find('\n');
            const size_t second = first == std::string::npos ? first : text.find('\n', first + 1);
            if (second == std::string::npos) return S_OK;
            const auto handler = handlers().find(text.substr(0, first));
            if (handler == handlers().end()) return S_OK;
            LPWSTR source = nullptr;
            // A sender WebView2 cannot name is no origin a page may call from.
            const std::string origin = SUCCEEDED(args->get_Source(&source)) ? originOf(take(source)) : "null";
            const std::string id = text.substr(first + 1, second - first - 1);
            handler->second(origin, text.substr(second + 1), [core, id](const std::string &reply) {
                onMainThread([core, message = wide(id + "\n" + reply)] { core->PostWebMessageAsString(message.c_str()); });
            });
            return S_OK;
        });
    EventRegistrationToken token;
    core->add_WebMessageReceived(received, &token);
    received->Release();
}

std::vector<uint8_t> readAll(IStream *stream) {
    std::vector<uint8_t> body;
    uint8_t chunk[65536];
    for (ULONG read = 0; SUCCEEDED(stream->Read(chunk, sizeof chunk, &read)) && read > 0;) body.insert(body.end(), chunk, chunk + read);
    return body;
}

const wchar_t *reasonOf(int status) {
    switch (status) {
    case 200: return L"OK";
    case 204: return L"No Content";
    case 206: return L"Partial Content";
    case 400: return L"Bad Request";
    case 403: return L"Forbidden";
    case 404: return L"Not Found";
    case 405: return L"Method Not Allowed";
    case 416: return L"Range Not Satisfiable";
    case 500: return L"Internal Server Error";
    default: return status < 400 ? L"OK" : L"Error";
    }
}

std::vector<std::pair<std::string, std::string>> headersOf(ICoreWebView2WebResourceRequest *request) {
    std::vector<std::pair<std::string, std::string>> headers;
    ICoreWebView2HttpRequestHeaders *all = nullptr;
    if (FAILED(request->get_Headers(&all)) || !all) return headers;
    ICoreWebView2HttpHeadersCollectionIterator *iterator = nullptr;
    if (SUCCEEDED(all->GetIterator(&iterator)) && iterator) {
        BOOL hasHeader = FALSE;
        while (SUCCEEDED(iterator->get_HasCurrentHeader(&hasHeader)) && hasHeader) {
            LPWSTR name = nullptr;
            LPWSTR value = nullptr;
            if (SUCCEEDED(iterator->GetCurrentHeader(&name, &value))) headers.emplace_back(take(name), take(value));
            BOOL hasNext = FALSE;
            if (FAILED(iterator->MoveNext(&hasNext)) || !hasNext) break;
        }
        iterator->Release();
    }
    all->Release();
    return headers;
}

class SchemeRegistration final : public ICoreWebView2CustomSchemeRegistration {
public:
    SchemeRegistration(std::wstring scheme, std::vector<std::wstring> origins) : scheme_(std::move(scheme)), origins_(std::move(origins)) {}

    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!out) return E_POINTER;
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, IID_ICoreWebView2CustomSchemeRegistration)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<ICoreWebView2CustomSchemeRegistration *>(this);
        AddRef();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE get_SchemeName(LPWSTR *name) override {
        *name = give(scheme_);
        return S_OK;
    }
    // Its pages are secure contexts, as https pages are.
    HRESULT STDMETHODCALLTYPE get_TreatAsSecure(BOOL *value) override {
        *value = TRUE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_TreatAsSecure(BOOL) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE GetAllowedOrigins(UINT32 *count, LPWSTR **origins) override {
        *count = static_cast<UINT32>(origins_.size());
        *origins = static_cast<LPWSTR *>(CoTaskMemAlloc(sizeof(LPWSTR) * (origins_.size() + 1)));
        for (size_t i = 0; i < origins_.size(); ++i) (*origins)[i] = give(origins_[i]);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetAllowedOrigins(UINT32, LPCWSTR *) override { return E_NOTIMPL; }
    // crossbind://app is an origin of its own.
    HRESULT STDMETHODCALLTYPE get_HasAuthorityComponent(BOOL *value) override {
        *value = TRUE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_HasAuthorityComponent(BOOL) override { return E_NOTIMPL; }

private:
    std::atomic<ULONG> refs_{1};
    std::wstring scheme_;
    std::vector<std::wstring> origins_;
};

class EnvironmentOptions final : public ICoreWebView2EnvironmentOptions, public ICoreWebView2EnvironmentOptions4 {
public:
    explicit EnvironmentOptions(ICoreWebView2CustomSchemeRegistration *scheme) : scheme_(scheme) {}
    ~EnvironmentOptions() { scheme_->Release(); }

    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!out) return E_POINTER;
        if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, IID_ICoreWebView2EnvironmentOptions)) {
            *out = static_cast<ICoreWebView2EnvironmentOptions *>(this);
        } else if (IsEqualIID(riid, IID_ICoreWebView2EnvironmentOptions4)) {
            *out = static_cast<ICoreWebView2EnvironmentOptions4 *>(this);
        } else {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        AddRef();
        return S_OK;
    }
    // WebView2's own loader passes WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS on to the browser; webview's, which the host
    // uses, does not.
    HRESULT STDMETHODCALLTYPE get_AdditionalBrowserArguments(LPWSTR *value) override {
        const wchar_t *arguments = _wgetenv(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        *value = arguments ? give(arguments) : nullptr;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_AdditionalBrowserArguments(LPCWSTR) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE get_Language(LPWSTR *value) override {
        *value = nullptr;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_Language(LPCWSTR) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE get_TargetCompatibleBrowserVersion(LPWSTR *value) override {
        *value = give(TARGET_VERSION);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_TargetCompatibleBrowserVersion(LPCWSTR) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE get_AllowSingleSignOnUsingOSPrimaryAccount(BOOL *allow) override {
        *allow = FALSE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_AllowSingleSignOnUsingOSPrimaryAccount(BOOL) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE GetCustomSchemeRegistrations(UINT32 *count, ICoreWebView2CustomSchemeRegistration ***registrations) override {
        *count = 1;
        *registrations = static_cast<ICoreWebView2CustomSchemeRegistration **>(CoTaskMemAlloc(sizeof(ICoreWebView2CustomSchemeRegistration *)));
        (*registrations)[0] = scheme_;
        scheme_->AddRef();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetCustomSchemeRegistrations(UINT32, ICoreWebView2CustomSchemeRegistration **) override { return E_NOTIMPL; }

private:
    std::atomic<ULONG> refs_{1};
    ICoreWebView2CustomSchemeRegistration *scheme_;
};

}  // namespace

void *schemeEnvironmentOptions(const char *scheme, const std::vector<std::string> &origins) {
    std::vector<std::wstring> allowed;
    for (const auto &origin : origins) allowed.push_back(wide(origin));
    return static_cast<ICoreWebView2EnvironmentOptions *>(new EnvironmentOptions(new SchemeRegistration(wide(scheme), std::move(allowed))));
}

void installReplyChannel(void *webView, const char *name, MessageHandler handler) {
    ICoreWebView2 *core = coreWebView(webView);
    listen(core);
    handlers()[name] = std::move(handler);
    addScript(core, std::string("__crossbind_channel('") + name + "');");
}

void forwardConsole(void *webView) {
    ICoreWebView2 *core = coreWebView(webView);
    listen(core);
    handlers()["crossbind_console"] = [](std::string, std::string message, ReplyFn) {
        const size_t cut = message.find('\n');
        const std::string level = message.substr(0, cut);
        std::FILE *out = level == "warn" || level == "error" ? stderr : stdout;
        std::fprintf(out, "%s\n", cut == std::string::npos ? "" : message.c_str() + cut + 1);
        std::fflush(out);
    };
    addScript(core, CONSOLE_SCRIPT);
}

void addTopFrameScript(void *webView, const std::string &source) { addScript(coreWebView(webView), source); }

// The scheme itself is registered with the environment (schemeEnvironmentOptions); this serves its requests.
void registerSchemeHandler(void *target, const char *scheme, SchemeHandler handler) {
    ICoreWebView2 *core = coreWebView(target);
    ICoreWebView2_2 *core2 = nullptr;
    core->QueryInterface(IID_ICoreWebView2_2, reinterpret_cast<void **>(&core2));
    ICoreWebView2Environment *environment = nullptr;
    core2->get_Environment(&environment);
    core2->Release();
    core->AddWebResourceRequestedFilter(wide(std::string(scheme) + "://*").c_str(), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    auto *serve = new SchemeHandler(std::move(handler));
    auto *requested = new Handler<ICoreWebView2WebResourceRequestedEventHandler, ICoreWebView2 *, ICoreWebView2WebResourceRequestedEventArgs *>(
        IID_ICoreWebView2WebResourceRequestedEventHandler,
        [serve, environment](ICoreWebView2 *, ICoreWebView2WebResourceRequestedEventArgs *args) -> HRESULT {
            ICoreWebView2WebResourceRequest *request = nullptr;
            if (FAILED(args->get_Request(&request))) return S_OK;
            SchemeRequest incoming;
            LPWSTR method = nullptr;
            request->get_Method(&method);
            incoming.method = take(method);
            LPWSTR uri = nullptr;
            request->get_Uri(&uri);
            const std::string url = take(uri);
            const size_t authority = url.find("://");
            const size_t path = url.find('/', authority == std::string::npos ? 0 : authority + 3);
            const size_t query = url.find('?', path == std::string::npos ? 0 : path);
            incoming.path = path == std::string::npos ? "/" : url.substr(path, query == std::string::npos ? std::string::npos : query - path);
            incoming.query = query == std::string::npos ? "" : url.substr(query + 1, url.find('#', query) - query - 1);
            IStream *content = nullptr;
            if (SUCCEEDED(request->get_Content(&content)) && content) {
                incoming.body = readAll(content);
                content->Release();
            }
            incoming.headers = headersOf(request);
            request->Release();
            ICoreWebView2Deferral *deferral = nullptr;
            args->GetDeferral(&deferral);
            args->AddRef();
            (*serve)(std::move(incoming), [args, deferral, environment](SchemeResponse response) {
                // WebView2 reads a stream on a thread of its own, which one made off the UI thread, as a file's is
                // here, lets it do without the UI thread.
                IStream *file = nullptr;
                if (!response.file.empty()
                    && FAILED(SHCreateStreamOnFileEx(wide(response.file).c_str(), STGM_READ | STGM_SHARE_DENY_NONE, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &file))) {
                    const std::string missing = "crossbind: the file went away before it was read";
                    file = nullptr;
                    response = SchemeResponse{404, "text/plain; charset=utf-8", std::vector<uint8_t>(missing.begin(), missing.end())};
                }
                onMainThread([args, deferral, environment, file, response = std::move(response)] {
                    IStream *body = file ? file : SHCreateMemStream(response.body.data(), static_cast<UINT>(response.body.size()));
                    std::string headers = "Content-Type: " + response.mime;
                    if (file) headers += "\r\nContent-Length: " + std::to_string(response.fileLength);
                    for (const auto &[name, value] : response.headers) headers += "\r\n" + name + ": " + value;
                    ICoreWebView2WebResourceResponse *answer = nullptr;
                    environment->CreateWebResourceResponse(body, response.status, reasonOf(response.status), wide(headers).c_str(), &answer);
                    args->put_Response(answer);
                    deferral->Complete();
                    if (answer) answer->Release();
                    if (body) body->Release();
                    deferral->Release();
                    args->Release();
                });
            });
            return S_OK;
        });
    EventRegistrationToken token;
    core->add_WebResourceRequested(requested, &token);
    requested->Release();
}

#include "page_requests.h"
#include "platform.h"
#include "windows/com.h"

#include <algorithm>
#include <cstdlib>

using namespace crossbind::windows;
namespace app = crossbind::app;

// WebView2 names the files a drop carries to the page alone, whose script hands each drop's over, with the paths
// WebView2 adds to them; page-drops hears of them as the page's own drop goes on. The script lets the page take files
// dragged over it, and a drop the page takes none of would open the file, which page-navigation refuses.
namespace {

constexpr const char *DROP = "crossbind:drop\n";

std::string originOf(const std::string &uri) {
    const auto scheme = uri.find("://");
    if (scheme == std::string::npos) return "";
    return uri.substr(0, uri.find_first_of("/?#", scheme + 3));
}

std::string dropScript(const std::vector<std::string> &origins) {
    std::string own;
    for (const auto &origin : origins) own += (own.empty() ? "'" : ",'") + origin + "'";
    return "if (window.top === window && [" + own + "].includes(location.protocol + '//' + location.host)) {"
           " const isFiles = (event) => !!event.dataTransfer && event.dataTransfer.types.includes('Files');"
           " for (const name of ['dragenter', 'dragover']) addEventListener(name, (event) => { if (isFiles(event)) event.preventDefault(); }, true);"
           " addEventListener('drop', (event) => {"
           "  if (!isFiles(event) || event.dataTransfer.files.length === 0) return;"
           "  chrome.webview.postMessageWithAdditionalObjects('crossbind:drop\\n' + event.clientX + '\\n' + event.clientY, event.dataTransfer.files);"
           " }, true);"
           "}";
}

std::vector<std::string> pathsOf(ICoreWebView2WebMessageReceivedEventArgs *args) {
    std::vector<std::string> paths;
    ICoreWebView2WebMessageReceivedEventArgs2 *args2 = nullptr;
    if (FAILED(args->QueryInterface(IID_ICoreWebView2WebMessageReceivedEventArgs2, reinterpret_cast<void **>(&args2)))) return paths;
    ICoreWebView2ObjectCollectionView *objects = nullptr;
    const HRESULT got = args2->get_AdditionalObjects(&objects);
    args2->Release();
    if (FAILED(got) || !objects) return paths;
    UINT32 count = 0;
    objects->get_Count(&count);
    for (UINT32 index = 0; index < count; index += 1) {
        IUnknown *object = nullptr;
        if (FAILED(objects->GetValueAtIndex(index, &object)) || !object) continue;
        ICoreWebView2File *file = nullptr;
        if (SUCCEEDED(object->QueryInterface(IID_ICoreWebView2File, reinterpret_cast<void **>(&file)))) {
            LPWSTR path = nullptr;
            // A file of no path, as one the page made, names none.
            const std::string named = SUCCEEDED(file->get_Path(&path)) ? take(path) : "";
            if (!named.empty()) paths.push_back(named);
            file->Release();
        }
        object->Release();
    }
    objects->Release();
    return paths;
}

HRESULT onMessage(const std::vector<std::string> &origins, ICoreWebView2WebMessageReceivedEventArgs *args) {
    LPWSTR raw = nullptr;
    if (FAILED(args->TryGetWebMessageAsString(&raw))) return S_OK;
    const std::string text = take(raw);
    const std::string head = DROP;
    const auto second = text.find('\n', head.size());
    if (text.compare(0, head.size(), head) != 0 || second == std::string::npos) return S_OK;
    LPWSTR source = nullptr;
    if (FAILED(args->get_Source(&source)) || std::find(origins.begin(), origins.end(), originOf(take(source))) == origins.end()) return S_OK;
    const double x = std::strtod(text.c_str() + head.size(), nullptr);
    const double y = std::strtod(text.c_str() + second + 1, nullptr);
    std::vector<std::string> paths = pathsOf(args);
    // Its owner may ask the app's user, which no WebView2 event's handler may wait for.
    if (!paths.empty()) onMainThread([paths = std::move(paths), x, y] { app::droppedFiles(paths, x, y); });
    return S_OK;
}

}  // namespace

void takeDrops(void *webView, std::vector<std::string> origins) {
    addTopFrameScript(webView, dropScript(origins));
    auto *received = new Handler<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *>(
        IID_ICoreWebView2WebMessageReceivedEventHandler,
        [origins = std::move(origins)](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT { return onMessage(origins, args); });
    EventRegistrationToken token;
    coreWebView(webView)->add_WebMessageReceived(received, &token);
    received->Release();
}

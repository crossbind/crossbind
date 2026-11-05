#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "desktop.h"
#include "platform.h"
#include "windows/com.h"

#include <knownfolders.h>
#include <shlobj.h>
#include <shlwapi.h>

#include <stdexcept>

using namespace crossbind::windows;

namespace {

std::string knownFolder(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr;
    if (FAILED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &path))) throw std::runtime_error("crossbind: Windows names no folder for the app's files");
    std::string out = utf8(path);
    CoTaskMemFree(path);
    return out;
}

std::string made(const std::string &path) {
    const int result = SHCreateDirectoryExW(nullptr, wide(path).c_str(), nullptr);
    if (result != ERROR_SUCCESS && result != ERROR_ALREADY_EXISTS && result != ERROR_FILE_EXISTS) {
        throw std::runtime_error("crossbind: cannot make the app's folder " + path);
    }
    return path;
}

bool exists(const std::string &path) { return GetFileAttributesW(wide(path).c_str()) != INVALID_FILE_ATTRIBUTES; }

}  // namespace

// What the app keeps roams with its user, as Windows apps do; its cache and logs stay on the machine.
crossbind::app::Paths appPaths() {
    const std::string id = CROSSBIND_APP_ID;
    const std::string local = knownFolder(FOLDERID_LocalAppData) + "\\" + id;
    return {made(knownFolder(FOLDERID_RoamingAppData) + "\\" + id), made(local + "\\Cache"), made(local + "\\Logs")};
}

// The profile is the page's cache as much as its storage, so it stays on the machine with the app's cache. A release
// before kept it where webview does, under the executable's name in the roaming folder: it moves here once, and where it
// cannot, as when the roaming folder is on another disk, the page keeps it there. A launch beside it may move it first.
std::wstring webViewProfile() {
    const std::string profile = made(knownFolder(FOLDERID_LocalAppData) + "\\" + CROSSBIND_APP_ID) + "\\WebView2";
    const std::wstring executable = executablePath();
    const std::string old = knownFolder(FOLDERID_RoamingAppData) + "\\" + utf8(PathFindFileNameW(executable.c_str()));
    if (!exists(profile) && exists(old)) MoveFileExW(wide(old).c_str(), wide(profile).c_str(), 0);
    return wide(exists(profile) || !exists(old) ? profile : old);
}

void crossbind::onMainThread(std::function<void()> fn) { windows::onMainThread(std::move(fn)); }

bool isMainThread() { return isUiThread(); }

// The windows go without asking the app's extensions, as the app quits once the loop ends.
void quitApp() {
    onMainThread([] { endLoop(); });
}

void showWindow(const std::string &) {
    onMainThread([] {
        const std::optional<crossbind::Window> front = crossbind::windowOf(crossbind::app::frontWindow());
        if (!front) return;
        HWND window = static_cast<HWND>(front->native());
        if (IsIconic(window)) ShowWindow(window, SW_RESTORE);
        SetForegroundWindow(window);
    });
}

void setBackgroundColor(void *, void *webView, std::uint32_t color) {
    ICoreWebView2Controller2 *controller = nullptr;
    if (FAILED(static_cast<ICoreWebView2Controller *>(webView)->QueryInterface(IID_ICoreWebView2Controller2, reinterpret_cast<void **>(&controller)))) {
        return;
    }
    controller->put_DefaultBackgroundColor({255, static_cast<BYTE>(color >> 16), static_cast<BYTE>(color >> 8), static_cast<BYTE>(color)});
    controller->Release();
}

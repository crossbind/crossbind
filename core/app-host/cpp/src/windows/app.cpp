#include "crossbind_app.h"
#include "platform.h"
#include "windows/com.h"

using namespace crossbind::windows;

// A Windows app is a directory: the executable, and the app's files in resources\ beside it.
std::string resourceDir() {
    const std::string executable = utf8(executablePath().c_str());
    return executable.substr(0, executable.find_last_of("\\/")) + "\\resources";
}

// The app ends with its window; anything else ends the process as it ends any other.
void onQuit(std::function<void()>) {}

// WebView2 shows the page's dialogs, file inputs and downloads itself.
void showPageDialogs(void *) {}

namespace {

// webview let an earlier crossbind's page read the clipboard without its user's gesture as well, and WebView2 keeps that
// answer in the profile, which it would give again without asking.
void forgetClipboardAnswer(ICoreWebView2 *webView) {
    ICoreWebView2_13 *withProfile = nullptr;
    if (FAILED(webView->QueryInterface(IID_ICoreWebView2_13, reinterpret_cast<void **>(&withProfile)))) return;
    ICoreWebView2Profile *profile = nullptr;
    ICoreWebView2Profile4 *permissions = nullptr;
    if (SUCCEEDED(withProfile->get_Profile(&profile)) && SUCCEEDED(profile->QueryInterface(IID_ICoreWebView2Profile4, reinterpret_cast<void **>(&permissions)))) {
        auto *done = new Handler<ICoreWebView2SetPermissionStateCompletedHandler, HRESULT>(IID_ICoreWebView2SetPermissionStateCompletedHandler,
                                                                                            [](HRESULT) -> HRESULT { return S_OK; });
        permissions->SetPermissionState(COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, L"crossbind://app", COREWEBVIEW2_PERMISSION_STATE_DEFAULT, done);
        done->Release();
        permissions->Release();
    }
    if (profile) profile->Release();
    withProfile->Release();
}

}  // namespace

// The page gets the devices app.permissions lists, and no other, without a question of WebView2's. It reads the clipboard
// on its user's gesture alone. WebView2 decides the rest.
void answerPermissions(void *webView) {
    auto *asked = new Handler<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2 *, ICoreWebView2PermissionRequestedEventArgs *>(
        IID_ICoreWebView2PermissionRequestedEventHandler, [](ICoreWebView2 *, ICoreWebView2PermissionRequestedEventArgs *args) -> HRESULT {
            COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            args->get_PermissionKind(&kind);
            bool isAllowed = false;
            switch (kind) {
            case COREWEBVIEW2_PERMISSION_KIND_CAMERA:
                isAllowed = CROSSBIND_APP_PERMISSION_CAMERA;
                break;
            case COREWEBVIEW2_PERMISSION_KIND_MICROPHONE:
                isAllowed = CROSSBIND_APP_PERMISSION_MICROPHONE;
                break;
            case COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION:
                isAllowed = CROSSBIND_APP_PERMISSION_LOCATION;
                break;
            case COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ: {
                BOOL isUserInitiated = FALSE;
                args->get_IsUserInitiated(&isUserInitiated);
                isAllowed = isUserInitiated;
                break;
            }
            default:
                return S_OK;
            }
            // A decision WebView2 kept would outlive an update that changes the list.
            ICoreWebView2PermissionRequestedEventArgs3 *kept = nullptr;
            if (SUCCEEDED(args->QueryInterface(IID_ICoreWebView2PermissionRequestedEventArgs3, reinterpret_cast<void **>(&kept)))) {
                kept->put_SavesInProfile(FALSE);
                kept->Release();
            }
            args->put_State(isAllowed ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
            return S_OK;
        });
    EventRegistrationToken token;
    coreWebView(webView)->add_PermissionRequested(asked, &token);
    asked->Release();
    forgetClipboardAnswer(coreWebView(webView));
}

void showError(const std::string &message) {
    MessageBoxW(nullptr, wide(message).c_str(), wide(CROSSBIND_APP_NAME " cannot open").c_str(), MB_OK | MB_ICONERROR);
}

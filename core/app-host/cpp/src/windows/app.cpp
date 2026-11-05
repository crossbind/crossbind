#include "app.h"
#include "crossbind_app.h"
#include "page_requests.h"
#include "platform.h"
#include "windows/com.h"

#include <optional>
#include <string>

using namespace crossbind::windows;

// A Windows app is a directory: the executable, and the app's files in resources\ beside it.
std::string resourceDir() {
    const std::string executable = utf8(executablePath().c_str());
    return executable.substr(0, executable.find_last_of("\\/")) + "\\resources";
}

namespace {

using crossbind::PageDialog;

// The page waits for a dialog's answer, which the extension that takes them gives once the event has returned. A page
// that leaves does so without asking, as WKWebView's does.
HRESULT onScriptDialog(ICoreWebView2 *, ICoreWebView2ScriptDialogOpeningEventArgs *args) {
    COREWEBVIEW2_SCRIPT_DIALOG_KIND type = COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT;
    args->get_Kind(&type);
    if (type == COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD) return args->Accept();
    const PageDialog::Kind kind = type == COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM  ? PageDialog::Kind::confirm
                                  : type == COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT ? PageDialog::Kind::prompt
                                                                                   : PageDialog::Kind::alert;
    LPWSTR message = nullptr;
    args->get_Message(&message);
    LPWSTR text = nullptr;
    if (kind == PageDialog::Kind::prompt) args->get_DefaultText(&text);
    ICoreWebView2Deferral *deferral = nullptr;
    if (FAILED(args->GetDeferral(&deferral))) {
        CoTaskMemFree(message);
        CoTaskMemFree(text);
        return S_OK;
    }
    args->AddRef();
    const PageDialog dialog(std::make_shared<PageDialog::State>(
        kind, take(message), take(text), [args, deferral, kind](std::optional<std::string> answer) {
            if (answer) {
                if (kind == PageDialog::Kind::prompt) args->put_ResultText(wide(*answer).c_str());
                args->Accept();
            }
            deferral->Complete();
            deferral->Release();
            args->Release();
        }));
    onMainThread([dialog] { crossbind::app::askPageDialog(dialog); });
    return S_OK;
}

}  // namespace

// The page's dialogs go to the extension that takes them, WebView2 showing none of its own; without one, WebView2
// shows its own. WebView2 shows the page's file inputs and downloads itself.
void showPageDialogs(void *webView) {
    if (!crossbind::app::hasPageDialogs()) return;
    ICoreWebView2Settings *settings = nullptr;
    if (SUCCEEDED(coreWebView(webView)->get_Settings(&settings))) {
        settings->put_AreDefaultScriptDialogsEnabled(FALSE);
        settings->Release();
    }
    auto *opening = new Handler<ICoreWebView2ScriptDialogOpeningEventHandler, ICoreWebView2 *, ICoreWebView2ScriptDialogOpeningEventArgs *>(
        IID_ICoreWebView2ScriptDialogOpeningEventHandler, onScriptDialog);
    EventRegistrationToken token;
    coreWebView(webView)->add_ScriptDialogOpening(opening, &token);
    opening->Release();
}

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

// What the page asks to use, by the names page-permissions takes.
std::string kindOf(COREWEBVIEW2_PERMISSION_KIND kind) {
    switch (kind) {
    case COREWEBVIEW2_PERMISSION_KIND_CAMERA:
        return "camera";
    case COREWEBVIEW2_PERMISSION_KIND_MICROPHONE:
        return "microphone";
    case COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION:
        return "location";
    case COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ:
        return "clipboard";
    case COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS:
        return "notifications";
    case COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE:
        return "files";
    case COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS:
        return "fonts";
    case COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES:
        return "midi";
    case COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT:
        return "window-management";
    case COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS:
        return "downloads";
    default:
        return "unknown";
    }
}

HRESULT onPermissionRequest(ICoreWebView2 *, ICoreWebView2PermissionRequestedEventArgs *args) {
    COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
    args->get_PermissionKind(&kind);
    // What WebView2 gives without asking stays its own.
    if (kind == COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY || kind == COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS) return S_OK;
    // A decision WebView2 kept would outlive an update that changes what the app allows.
    ICoreWebView2PermissionRequestedEventArgs3 *kept = nullptr;
    if (SUCCEEDED(args->QueryInterface(IID_ICoreWebView2PermissionRequestedEventArgs3, reinterpret_cast<void **>(&kept)))) {
        kept->put_SavesInProfile(FALSE);
        kept->Release();
    }
    // The page reads the clipboard on its user's gesture alone, as WebKit's does.
    BOOL isUserInitiated = FALSE;
    args->get_IsUserInitiated(&isUserInitiated);
    if (kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ && !isUserInitiated) return args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
    LPWSTR uri = nullptr;
    args->get_Uri(&uri);
    ICoreWebView2Deferral *deferral = nullptr;
    if (FAILED(args->GetDeferral(&deferral))) {
        CoTaskMemFree(uri);
        return args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
    }
    args->AddRef();
    const crossbind::PagePermission request = crossbind::app::pagePermission({kindOf(kind)}, crossbind::app::originOf(take(uri)), [args, deferral](bool isAllowed) {
        args->put_State(isAllowed ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
        deferral->Complete();
        deferral->Release();
        args->Release();
    });
    onMainThread([request] { crossbind::app::askPagePermission(request); });
    return S_OK;
}

}  // namespace

// What the page asks to use goes to page-permissions, so that WebView2 asks the app's user nothing of its own; without
// it, WebView2 asks as it would.
void answerPermissions(void *webView) {
    forgetClipboardAnswer(coreWebView(webView));
    if (!crossbind::app::hasPagePermissions()) return;
    auto *asked = new Handler<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2 *, ICoreWebView2PermissionRequestedEventArgs *>(
        IID_ICoreWebView2PermissionRequestedEventHandler, onPermissionRequest);
    EventRegistrationToken token;
    coreWebView(webView)->add_PermissionRequested(asked, &token);
    asked->Release();
}

void showError(const std::string &message) {
    MessageBoxW(nullptr, wide(message).c_str(), wide(CROSSBIND_APP_NAME " cannot open").c_str(), MB_OK | MB_ICONERROR);
}

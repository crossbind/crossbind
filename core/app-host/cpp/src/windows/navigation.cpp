#include "page_requests.h"
#include "platform.h"
#include "windows/com.h"

#include <algorithm>

using namespace crossbind::windows;
using crossbind::CertificateError;
using crossbind::HttpAuthentication;
namespace app = crossbind::app;

// The app's own origins load in any frame, but a window the page asks for at one of them opens nowhere, as the app
// opens no window of its own; the extension page-navigation decides every other URL, windows too, which load in the
// page's place if they load. A page of another origin gets no token, so it reaches none of the app's functions.
namespace {

struct Lock {
    std::vector<std::string> origins;
    std::function<void()> newPage;
    // A window's URL page-navigation loaded in the page's place, whose navigation it does not decide again.
    std::string approved;
};

std::string originOf(const std::string &uri) {
    const auto scheme = uri.find("://");
    if (scheme == std::string::npos) return uri;
    return uri.substr(0, uri.find_first_of("/?#", scheme + 3));
}

bool allows(const Lock &lock, const std::string &uri) {
    if (uri.rfind("about:", 0) == 0) return true;
    // A blob URL carries the origin of the page that made it.
    if (uri.rfind("blob:", 0) == 0) return allows(lock, uri.substr(5));
    return std::find(lock.origins.begin(), lock.origins.end(), originOf(uri)) != lock.origins.end();
}

bool isApproved(Lock &lock, const std::string &uri) {
    if (lock.approved.empty() || uri != lock.approved) return false;
    lock.approved.clear();
    return true;
}

// A URL's host and port, as its origin names them.
std::string hostOf(const std::string &uri) {
    const auto scheme = uri.find("://");
    const std::string authority = originOf(uri).substr(scheme == std::string::npos ? 0 : scheme + 3);
    const auto user = authority.rfind('@');
    return user == std::string::npos ? authority : authority.substr(user + 1);
}

using Starting = Handler<ICoreWebView2NavigationStartingEventHandler, ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *>;

Starting *decide(Lock *lock, bool isMainFrame) {
    return new Starting(IID_ICoreWebView2NavigationStartingEventHandler,
        [lock, isMainFrame](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *args) -> HRESULT {
            LPWSTR requested = nullptr;
            args->get_Uri(&requested);
            const std::string uri = take(requested);
            if (isApproved(*lock, uri) || allows(*lock, uri)) return S_OK;
            BOOL followed = FALSE;
            args->get_IsUserInitiated(&followed);
            const app::NavigationAnswer answer = app::decideNavigation(uri, isMainFrame, followed != FALSE, false);
            if (answer == app::NavigationAnswer::load) return S_OK;
            if (answer == app::NavigationAnswer::openOutside) openOutside(uri);
            args->put_Cancel(TRUE);
            return S_OK;
        });
}

// The realm a server's challenge names, as Basic realm="Staging" does, or "".
std::string realmOf(const std::string &challenge) {
    static const std::string named = "realm=\"";
    const auto start = challenge.find(named);
    if (start == std::string::npos) return "";
    const auto from = start + named.size();
    const auto end = challenge.find('"', from);
    return challenge.substr(from, end == std::string::npos ? std::string::npos : end - from);
}

// A user's name and password a server asks for, which WebView2 would ask the app's user for itself: a cancel goes on
// without them, so the page gets what the server answers to that. WebView2 tells no proxy's ask from a server's.
void takeAuthentication(ICoreWebView2 *core) {
    ICoreWebView2_10 *core10 = nullptr;
    if (FAILED(core->QueryInterface(IID_ICoreWebView2_10, reinterpret_cast<void **>(&core10)))) return;
    auto *asked = new Handler<ICoreWebView2BasicAuthenticationRequestedEventHandler, ICoreWebView2 *, ICoreWebView2BasicAuthenticationRequestedEventArgs *>(
        IID_ICoreWebView2BasicAuthenticationRequestedEventHandler, [](ICoreWebView2 *, ICoreWebView2BasicAuthenticationRequestedEventArgs *args) -> HRESULT {
            LPWSTR uri = nullptr;
            args->get_Uri(&uri);
            const std::string host = hostOf(take(uri));
            LPWSTR challenge = nullptr;
            args->get_Challenge(&challenge);
            const std::string realm = realmOf(take(challenge));
            ICoreWebView2BasicAuthenticationResponse *response = nullptr;
            if (FAILED(args->get_Response(&response))) return S_OK;
            ICoreWebView2Deferral *deferral = nullptr;
            if (FAILED(args->GetDeferral(&deferral))) {
                response->Release();
                return S_OK;
            }
            args->AddRef();
            const HttpAuthentication request = app::make<HttpAuthentication>(std::make_shared<app::StateOf<HttpAuthentication>>(host, realm, false,
                [args, response, deferral](std::optional<std::pair<std::string, std::string>> given) {
                    onMainThread([args, response, deferral, given] {
                        if (given) {
                            response->put_UserName(wide(given->first).c_str());
                            response->put_Password(wide(given->second).c_str());
                        } else {
                            args->put_Cancel(TRUE);
                        }
                        deferral->Complete();
                        deferral->Release();
                        response->Release();
                        args->Release();
                    });
                }));
            // Its owner may ask the app's user, which no WebView2 event's handler may wait for.
            onMainThread([request] { app::askHttpAuthentication(request); });
            return S_OK;
        });
    EventRegistrationToken token;
    core10->add_BasicAuthenticationRequested(asked, &token);
    asked->Release();
    core10->Release();
}

std::string reasonOf(COREWEBVIEW2_WEB_ERROR_STATUS status) {
    switch (status) {
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT: return "the certificate is another host's";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED: return "the certificate has expired";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED: return "the certificate was revoked";
    default: return "the certificate is invalid";
    }
}

// A request whose server's certificate the system does not trust: one page-navigation trusts goes on, as the host's
// later ones with the certificate do; one it refuses fails, without WebView2's own error page, which would let the
// app's user go on.
void takeCertificateErrors(ICoreWebView2 *core) {
    ICoreWebView2_14 *core14 = nullptr;
    if (FAILED(core->QueryInterface(IID_ICoreWebView2_14, reinterpret_cast<void **>(&core14)))) return;
    auto *detected = new Handler<ICoreWebView2ServerCertificateErrorDetectedEventHandler, ICoreWebView2 *, ICoreWebView2ServerCertificateErrorDetectedEventArgs *>(
        IID_ICoreWebView2ServerCertificateErrorDetectedEventHandler, [](ICoreWebView2 *, ICoreWebView2ServerCertificateErrorDetectedEventArgs *args) -> HRESULT {
            LPWSTR requested = nullptr;
            args->get_RequestUri(&requested);
            const std::string uri = take(requested);
            COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
            args->get_ErrorStatus(&status);
            ICoreWebView2Deferral *deferral = nullptr;
            if (FAILED(args->GetDeferral(&deferral))) return S_OK;
            args->AddRef();
            const CertificateError error = app::make<CertificateError>(std::make_shared<app::StateOf<CertificateError>>(uri, hostOf(uri), reasonOf(status), [args, deferral](bool isTrusted) {
                onMainThread([args, deferral, isTrusted] {
                    args->put_Action(isTrusted ? COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW : COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL);
                    deferral->Complete();
                    deferral->Release();
                    args->Release();
                });
            }));
            onMainThread([error] { app::askCertificateError(error); });
            return S_OK;
        });
    EventRegistrationToken token;
    core14->add_ServerCertificateErrorDetected(detected, &token);
    detected->Release();
    core14->Release();
}

}  // namespace

void restrictNavigation(void *webView, std::vector<std::string> origins, std::function<void()> newPage) {
    ICoreWebView2 *core = coreWebView(webView);
    auto *lock = new Lock{std::move(origins), std::move(newPage), {}};
    EventRegistrationToken token;
    Starting *top = decide(lock, true);
    core->add_NavigationStarting(top, &token);
    top->Release();
    Starting *frames = decide(lock, false);
    core->add_FrameNavigationStarting(frames, &token);
    frames->Release();
    auto *windows = new Handler<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2 *, ICoreWebView2NewWindowRequestedEventArgs *>(
        IID_ICoreWebView2NewWindowRequestedEventHandler, [lock](ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args) -> HRESULT {
            LPWSTR requested = nullptr;
            args->get_Uri(&requested);
            const std::string uri = take(requested);
            BOOL followed = FALSE;
            args->get_IsUserInitiated(&followed);
            args->put_Handled(TRUE);
            const app::NavigationAnswer answer = allows(*lock, uri) ? app::NavigationAnswer::refuse : app::decideNavigation(uri, true, followed != FALSE, true);
            if (answer == app::NavigationAnswer::load) {
                lock->approved = uri;
                sender->Navigate(wide(uri).c_str());
            }
            if (answer == app::NavigationAnswer::openOutside) openOutside(uri);
            return S_OK;
        });
    core->add_NewWindowRequested(windows, &token);
    windows->Release();
    auto *loading = new Handler<ICoreWebView2ContentLoadingEventHandler, ICoreWebView2 *, ICoreWebView2ContentLoadingEventArgs *>(
        IID_ICoreWebView2ContentLoadingEventHandler, [lock](ICoreWebView2 *, ICoreWebView2ContentLoadingEventArgs *) -> HRESULT {
            // An approval no load in place took goes with the page it came from.
            lock->approved.clear();
            lock->newPage();
            return S_OK;
        });
    core->add_ContentLoading(loading, &token);
    loading->Release();
    takeAuthentication(core);
    takeCertificateErrors(core);
}

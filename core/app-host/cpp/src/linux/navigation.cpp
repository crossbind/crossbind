#include "main_thread.h"
#include "page_requests.h"
#include "platform.h"

#include <webkit2/webkit2.h>

#include <algorithm>

using crossbind::CertificateError;
using crossbind::HttpAuthentication;
namespace app = crossbind::app;

// The app's own origins load in any frame, but a window the page asks for at one of them opens nowhere, as the app
// opens no window of its own; the extension page-navigation decides every other URL, windows too, which load in the
// page's place if they load. A page of another origin gets no token, so it reaches none of the app's functions.
// WebKitGTK tells no frame, so each navigation is the top frame's to page-navigation.
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

gboolean onDecidePolicy(WebKitWebView *view, WebKitPolicyDecision *decision, WebKitPolicyDecisionType type, gpointer data) {
    if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION && type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) return FALSE;
    auto *lock = static_cast<Lock *>(data);
    WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(WEBKIT_NAVIGATION_POLICY_DECISION(decision));
    const char *requested = webkit_uri_request_get_uri(webkit_navigation_action_get_request(action));
    const std::string uri = requested ? requested : "";
    const bool isNewWindow = type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION;
    if (!isNewWindow && (isApproved(*lock, uri) || allows(*lock, uri))) return FALSE;
    const app::NavigationAnswer answer =
        allows(*lock, uri) ? app::NavigationAnswer::refuse : app::decideNavigation(uri, true, webkit_navigation_action_is_user_gesture(action), isNewWindow);
    if (answer == app::NavigationAnswer::load && !isNewWindow) return FALSE;
    webkit_policy_decision_ignore(decision);
    if (answer == app::NavigationAnswer::load) {
        lock->approved = uri;
        webkit_web_view_load_uri(view, uri.c_str());
    }
    if (answer == app::NavigationAnswer::openOutside) g_app_info_launch_default_for_uri(uri.c_str(), nullptr, nullptr);
    return TRUE;
}

// An approval no load in place took goes with the page it came from.
void onLoadChanged(WebKitWebView *, WebKitLoadEvent event, gpointer data) {
    if (event != WEBKIT_LOAD_COMMITTED) return;
    auto *lock = static_cast<Lock *>(data);
    lock->approved.clear();
    lock->newPage();
}

// A host as an origin names it: with its port, but for http's and https' own.
std::string hostOf(const char *host, guint port) {
    std::string named = host ? host : "";
    if (port != 0 && port != 80 && port != 443) named += ":" + std::to_string(port);
    return named;
}

// A user's name and password a server asks for; a cancel goes on without them, so the page gets what the server answers
// to that, and WebKitGTK asks nothing of its own.
gboolean onAuthenticate(WebKitWebView *, WebKitAuthenticationRequest *request, gpointer) {
    switch (webkit_authentication_request_get_scheme(request)) {
    case WEBKIT_AUTHENTICATION_SCHEME_HTTP_BASIC:
    case WEBKIT_AUTHENTICATION_SCHEME_HTTP_DIGEST:
    case WEBKIT_AUTHENTICATION_SCHEME_NTLM:
    case WEBKIT_AUTHENTICATION_SCHEME_NEGOTIATE:
        break;
    default:
        return FALSE;
    }
    const char *realm = webkit_authentication_request_get_realm(request);
    g_object_ref(request);
    app::askHttpAuthentication(app::make<HttpAuthentication>(std::make_shared<app::StateOf<HttpAuthentication>>(
        hostOf(webkit_authentication_request_get_host(request), webkit_authentication_request_get_port(request)), realm ? realm : "",
        webkit_authentication_request_is_for_proxy(request), [request](std::optional<std::pair<std::string, std::string>> given) {
            onMainThread([request, given] {
                WebKitCredential *credential = given ? webkit_credential_new(given->first.c_str(), given->second.c_str(), WEBKIT_CREDENTIAL_PERSISTENCE_FOR_SESSION) : nullptr;
                webkit_authentication_request_authenticate(request, credential);
                if (credential) webkit_credential_free(credential);
                g_object_unref(request);
            });
        })));
    return TRUE;
}

std::string reasonOf(GTlsCertificateFlags errors) {
    if (errors & G_TLS_CERTIFICATE_UNKNOWN_CA) return "the certificate's authority is unknown";
    if (errors & G_TLS_CERTIFICATE_BAD_IDENTITY) return "the certificate is another host's";
    if (errors & G_TLS_CERTIFICATE_NOT_ACTIVATED) return "the certificate is not valid yet";
    if (errors & G_TLS_CERTIFICATE_EXPIRED) return "the certificate has expired";
    if (errors & G_TLS_CERTIFICATE_REVOKED) return "the certificate was revoked";
    if (errors & G_TLS_CERTIFICATE_INSECURE) return "the certificate's algorithm is insecure";
    return "the certificate is invalid";
}

// A page whose server's certificate the system does not trust: one page-navigation trusts loads anew, without asking
// again, as the host's other pages do with it from then on; one it refuses shows nothing.
gboolean onTlsErrors(WebKitWebView *view, gchar *failing, GTlsCertificate *certificate, GTlsCertificateFlags errors, gpointer data) {
    auto *lock = static_cast<Lock *>(data);
    const std::string url = failing ? failing : "";
    GUri *parsed = g_uri_parse(url.c_str(), G_URI_FLAGS_NONE, nullptr);
    const std::string host = parsed && g_uri_get_host(parsed) ? g_uri_get_host(parsed) : "";
    const std::string named = parsed ? hostOf(g_uri_get_host(parsed), g_uri_get_port(parsed) < 0 ? 0 : static_cast<guint>(g_uri_get_port(parsed))) : host;
    if (parsed) g_uri_unref(parsed);
    g_object_ref(view);
    g_object_ref(certificate);
    app::askCertificateError(app::make<CertificateError>(std::make_shared<app::StateOf<CertificateError>>(url, named, reasonOf(errors), [view, certificate, url, host, lock](bool isTrusted) {
        onMainThread([view, certificate, url, host, lock, isTrusted] {
            if (isTrusted) {
                webkit_web_context_allow_tls_certificate_for_host(webkit_web_view_get_context(view), certificate, host.c_str());
                lock->approved = url;
                webkit_web_view_load_uri(view, url.c_str());
            }
            g_object_unref(certificate);
            g_object_unref(view);
        });
    })));
    return TRUE;
}

}  // namespace

void restrictNavigation(void *webView, std::vector<std::string> origins, std::function<void()> newPage) {
    auto *lock = new Lock{std::move(origins), std::move(newPage)};
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "decide-policy", G_CALLBACK(onDecidePolicy), lock);
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "load-changed", G_CALLBACK(onLoadChanged), lock);
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "authenticate", G_CALLBACK(onAuthenticate), nullptr);
    g_signal_connect(WEBKIT_WEB_VIEW(webView), "load-failed-with-tls-errors", G_CALLBACK(onTlsErrors), lock);
}

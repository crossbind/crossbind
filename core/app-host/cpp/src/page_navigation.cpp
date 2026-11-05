// The page's navigations beyond the app's origins, which the holder of page-navigation decides, and the authentications
// and certificate errors of the pages they load, which the holder of page-authentication answers (<crossbind/extension.h>).
#include "crossbind/extension.h"
#include "page_requests.h"

#include <algorithm>
#include <cctype>
#include <cstdio>

namespace crossbind {

namespace {

// The schemes the system's browser and mail app take; the app opens no other program for a page.
bool opensOutside(const std::string &url) {
    std::string scheme = url.substr(0, url.find(':'));
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return scheme == "http" || scheme == "https" || scheme == "mailto";
}

}  // namespace

const std::string &Navigation::url() const { return state_->url; }

bool Navigation::isMainFrame() const { return state_->isMainFrame; }

bool Navigation::isUserInitiated() const { return state_->isUserInitiated; }

bool Navigation::isNewWindow() const { return state_->isNewWindow; }

Page Navigation::page() const { return state_->page; }

const std::string &HttpAuthentication::host() const { return state_->host; }

const std::string &HttpAuthentication::realm() const { return state_->realm; }

bool HttpAuthentication::isProxy() const { return state_->isProxy; }

Page HttpAuthentication::page() const { return state_->page; }

void HttpAuthentication::answer(const std::string &user, const std::string &password) const { state_->answer.give(std::make_pair(user, password)); }

void HttpAuthentication::cancel() const { state_->answer.give(std::nullopt); }

void HttpAuthentication::useDefault() const { cancel(); }

const std::string &CertificateError::url() const { return state_->url; }

const std::string &CertificateError::host() const { return state_->host; }

const std::string &CertificateError::reason() const { return state_->reason; }

Page CertificateError::page() const { return state_->page; }

void CertificateError::trust() const { state_->answer.give(true); }

void CertificateError::refuse() const { state_->answer.give(false); }

void CertificateError::useDefault() const { refuse(); }

namespace app {

NavigationAnswer decideNavigation(std::string url, bool isMainFrame, bool isUserInitiated, bool isNewWindow) {
    const auto &owner = navigationOwner();
    if (!owner) return NavigationAnswer::refuse;
    auto state = std::make_shared<StateOf<Navigation>>();
    state->url = std::move(url);
    state->isMainFrame = isMainFrame;
    state->isUserInitiated = isUserInitiated;
    state->isNewWindow = isNewWindow;
    NavigationAnswer answer = NavigationAnswer::refuse;
    try {
        answer = owner(make<Navigation>(state));
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on %s: %s\n", holderOf("page-navigation").c_str(), state->url.c_str(), error.what());
        return NavigationAnswer::refuse;
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on %s\n", holderOf("page-navigation").c_str(), state->url.c_str());
        return NavigationAnswer::refuse;
    }
    if (answer == NavigationAnswer::load) return answer;
    return answer == NavigationAnswer::openOutside && opensOutside(state->url) ? answer : NavigationAnswer::refuse;
}

// What the owner throws cancels the request, which an answer the owner gave before keeps as it is.
void askHttpAuthentication(HttpAuthentication request) {
    const auto &owner = httpAuthenticationOwner();
    if (!owner) {
        request.cancel();
        return;
    }
    try {
        owner(request);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on an authentication of %s: %s\n", holderOf("page-authentication").c_str(), request.host().c_str(),
            error.what());
        request.cancel();
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on an authentication of %s\n", holderOf("page-authentication").c_str(), request.host().c_str());
        request.cancel();
    }
}

void askCertificateError(CertificateError error) {
    const auto &owner = certificateErrorOwner();
    if (!owner) {
        error.refuse();
        return;
    }
    try {
        owner(error);
    } catch (const std::exception &failure) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the certificate of %s: %s\n", holderOf("page-authentication").c_str(), error.host().c_str(),
            failure.what());
        error.refuse();
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the certificate of %s\n", holderOf("page-authentication").c_str(), error.host().c_str());
        error.refuse();
    }
}

}  // namespace app

}  // namespace crossbind

#pragma once

// The page's navigations, downloads, drops, dialogs, what it asks to use and its file inputs, as a platform's webview
// hands them over: the core hands each to the holder of its role, page-navigation, page-authentication, page-downloads,
// page-drops, page-dialogs, page-permissions or page-files.
#include "access.h"

#ifdef __OBJC__
#import <WebKit/WebKit.h>
#endif

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace crossbind {

// The answer a request gets once, on the thread that gives it, which the platform's own code takes on: the fallback
// when every copy of the request goes unanswered.
template <typename Answer>
class GivenOnce {
public:
    GivenOnce(std::function<void(Answer)> answer, Answer fallback) : answer_(std::move(answer)), fallback_(std::move(fallback)) {}
    GivenOnce(const GivenOnce &) = delete;
    GivenOnce &operator=(const GivenOnce &) = delete;
    ~GivenOnce() { give(std::move(fallback_)); }

    // Whether this was the answer, as none before it was.
    bool give(Answer value) {
        if (isGiven_.exchange(true)) return false;
        answer_(std::move(value));
        return true;
    }

private:
    std::function<void(Answer)> answer_;
    Answer fallback_;
    std::atomic<bool> isGiven_{false};
};

namespace app {
using crossbind::NavigationAnswer;

// Where saveTo() saves a download, or ask(), or cancel().
struct DownloadAnswer {
    enum class Kind { saveTo, ask, cancel };
    Kind kind = Kind::cancel;
    std::string path;
};

// What a download's owner hears as it goes on, which the platform keeps as long as it runs, as every copy of the
// download may go first.
struct DownloadEvents {
    std::mutex mutex;
    std::function<void(int64_t, int64_t)> progress;
    std::function<void(const DownloadEnd &)> finish;
    // Stops the download once it runs, from any thread.
    std::function<void()> stop;
    // Whether a cancel() came after the answer.
    bool isStopped = false;
    bool isFinished = false;
    std::chrono::steady_clock::time_point told;
};

// What the holder of page-permissions answers: allow, deny, or what the webview does, which asks its user on Apple's
// platforms and on Windows, and denies on Linux.
enum class PermissionAnswer { allow, deny, useDefault };
}  // namespace app

// A navigation, which its owner answers as its hook returns.
struct Navigation::State {
    std::string url;
    bool isMainFrame = true;
    bool isUserInitiated = false;
    bool isNewWindow = false;
    Page page = app::shownPage();
};

// The name and password an authentication answers with; none for a cancel.
struct HttpAuthentication::State {
    State(std::string host, std::string realm, bool isProxy, std::function<void(std::optional<std::pair<std::string, std::string>>)> answer)
        : host(std::move(host)), realm(std::move(realm)), isProxy(isProxy), answer(std::move(answer), std::nullopt) {}

    std::string host;
    std::string realm;
    bool isProxy;
    Page page = app::shownPage();
    GivenOnce<std::optional<std::pair<std::string, std::string>>> answer;
};

// Whether the certificate is trusted.
struct CertificateError::State {
    State(std::string url, std::string host, std::string reason, std::function<void(bool)> answer)
        : url(std::move(url)), host(std::move(host)), reason(std::move(reason)), answer(std::move(answer), false) {}

    std::string url;
    std::string host;
    std::string reason;
    Page page = app::shownPage();
    GivenOnce<bool> answer;
};

namespace app {
// A name as a file's, which no folder in it takes elsewhere: its last part, or "download" for none.
std::string fileNameOf(const std::string &name);
}  // namespace app

struct Download::State {
    State(std::string url, const std::string &suggestedName, std::string mimeType, int64_t size, std::shared_ptr<app::DownloadEvents> events,
        std::function<void(app::DownloadAnswer)> answer)
        : url(std::move(url)), suggestedName(app::fileNameOf(suggestedName)), mimeType(std::move(mimeType)), size(size), events(std::move(events)),
          answer(std::move(answer), app::DownloadAnswer{}) {}

    std::string url;
    std::string suggestedName;
    std::string mimeType;
    int64_t size;
    Page page = app::shownPage();
    std::shared_ptr<app::DownloadEvents> events;
    GivenOnce<app::DownloadAnswer> answer;
};

}  // namespace crossbind

namespace crossbind::app {

// The holder of each role's hook, or an empty function without one.
const std::function<NavigationAnswer(const Navigation &)> &navigationOwner();
const std::function<void(HttpAuthentication)> &httpAuthenticationOwner();
const std::function<void(CertificateError)> &certificateErrorOwner();
// The owner's answer to a navigation beyond the app's origins, which the platform's webview then carries out, on the
// main thread: refuse without an owner, for useDefault, for an owner that fails, and for an openOutside of a scheme
// that is neither http, https nor mailto.
NavigationAnswer decideNavigation(std::string url, bool isMainFrame, bool isUserInitiated, bool isNewWindow);
// Hand a request to its owner: one without an owner, or whose owner fails on it, is cancelled or refused.
void askHttpAuthentication(HttpAuthentication request);
void askCertificateError(CertificateError error);

const std::function<void(Download)> &downloadOwner();
// Hands a download to page-downloads on the main thread: one without an owner saves as ask() does, and one whose owner
// fails on it before an answer is cancelled.
void askDownload(std::shared_ptr<StateOf<Download>> download);
// How the platform stops a download it starts on its answer: false when a cancel() came first, so it starts none.
bool startDownload(DownloadEvents &events, std::function<void()> stop);
// What the platform tells a download's owner, on the main thread: what has arrived, at most every 100 ms and once all
// of it has, and how it ended, once.
void tellProgress(DownloadEvents &events, const std::string &url, int64_t received, int64_t size);
void tellFinish(DownloadEvents &events, const std::string &url, DownloadEnd end);

// Hands the files the app's user dropped on the page to page-drops, on the main thread, with the page's point in CSS
// pixels: nothing without an owner.
void droppedFiles(const std::vector<std::string> &paths, double x, double y);

}  // namespace crossbind::app

#if !defined(__ANDROID__)

namespace crossbind {

// The answer the webview gets once, on the main thread, where it takes it: the fallback when every copy of its request
// goes unanswered. A webview that takes a request itself as long as the hook runs, as WebKitGTK does once its signal
// returns false, offers that to useDefault(), which else gives the fallback.
template <typename Answer>
class AnswerOnce {
public:
    AnswerOnce(std::function<void(Answer)> answer, Answer fallback, bool offersDefault = false)
        : answer_(std::move(answer)), fallback_(std::move(fallback)), phase_(offersDefault ? Phase::offered : Phase::open) {}
    AnswerOnce(const AnswerOnce &) = delete;
    AnswerOnce &operator=(const AnswerOnce &) = delete;
    ~AnswerOnce() { give(std::move(fallback_)); }

    void give(Answer value) {
        Phase was = phase_.load();
        do {
            if (was == Phase::given || was == Phase::left) return;
        } while (!phase_.compare_exchange_weak(was, Phase::given));
        onMainThread([answer = std::move(answer_), value = std::move(value)] { answer(value); });
    }
    void giveDefault() {
        Phase offered = Phase::offered;
        if (!phase_.compare_exchange_strong(offered, Phase::left)) give(fallback_);
    }
    // As the hook returns: whether its owner left the request to the webview, which takes it from here.
    bool isLeft() {
        Phase offered = Phase::offered;
        phase_.compare_exchange_strong(offered, Phase::open);
        return phase_ == Phase::left;
    }

private:
    enum class Phase { offered, open, given, left };

    std::function<void(Answer)> answer_;
    Answer fallback_;
    std::atomic<Phase> phase_;
};

// A dialog's answer: the text a prompt gives, or an alert's or a confirm's OK, with an empty one; none for Cancel.
struct PageDialog::State {
    State(Kind kind, std::string message, std::string defaultText, std::function<void(std::optional<std::string>)> answer, bool offersDefault = false)
        : kind(kind), message(std::move(message)), defaultText(std::move(defaultText)), answer(std::move(answer), std::nullopt, offersDefault) {}

    Kind kind;
    std::string message;
    std::string defaultText;
    Page page = app::shownPage();
    AnswerOnce<std::optional<std::string>> answer;
};

struct PagePermission::State {
    State(std::vector<std::string> kinds, std::string origin, bool isListed, std::function<void(app::PermissionAnswer)> answer)
        : kinds(std::move(kinds)), origin(std::move(origin)), isListed(isListed), answer(std::move(answer), app::PermissionAnswer::deny) {}

    std::vector<std::string> kinds;
    std::string origin;
    bool isListed;
    Page page = app::shownPage();
    AnswerOnce<app::PermissionAnswer> answer;
};

// A file input's answer: the paths picked; none for Cancel.
struct FileInput::State {
    State(bool allowsMultiple, bool allowsFolders, std::vector<std::string> accept, std::function<void(std::optional<std::vector<std::string>>)> answer,
        bool offersDefault = false)
        : allowsMultiple(allowsMultiple), allowsFolders(allowsFolders), accept(std::move(accept)), answer(std::move(answer), std::nullopt, offersDefault) {}

    bool allowsMultiple;
    bool allowsFolders;
    std::vector<std::string> accept;
    Page page = app::shownPage();
    AnswerOnce<std::optional<std::vector<std::string>>> answer;
};

}  // namespace crossbind

namespace crossbind::app {

#ifdef __OBJC__
// An origin as the page's scripts name it, as "crossbind://app" or "http://localhost:5173".
inline std::string originOf(WKSecurityOrigin *origin) {
    std::string text = std::string(origin.protocol.UTF8String ?: "") + "://" + std::string(origin.host.UTF8String ?: "");
    if (origin.port != 0) text += ":" + std::to_string(origin.port);
    return text;
}
#endif

// The app's own origins, which attach() gives as the page's first loads: a page of another origin, which page-navigation
// may load, gets no dialog and nothing it asks to use, as each would show under the app's name.
void setOwnOrigins(std::vector<std::string> origins);
bool isOwnOrigin(const std::string &origin);

// A request of the page's for these kinds, which knows whether app.permissions lists each.
PagePermission pagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(PermissionAnswer)> decide);

// Whether an extension takes them on this platform; without one, the webview does as it would.
bool hasPageDialogs();
bool hasPagePermissions();
bool hasFileInputs();
// Hand a request to its owner, on the main thread: one the owner fails on goes unanswered, and so cancelled. Whether the
// owner left a dialog or a file input to the webview, which takes it from here.
bool askPageDialog(PageDialog dialog);
void askPagePermission(PagePermission request);
bool askFileInput(FileInput input);

}  // namespace crossbind::app

#endif

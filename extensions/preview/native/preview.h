// What the preview extension's files share: the cloud the build asks, the account signed in and its token, the session
// forms, and what each platform gives: its store of secrets, HMAC-SHA256 and SHA-256, random bytes and its sign-in sheet.
#pragma once

#include "crossbind/extension.h"

#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace preview {

using crossbind::Value;
using Failure = std::optional<std::string>;
using Done = std::function<void(Failure failure)>;
using Digest = std::function<void(Failure failure, std::string digest)>;

// The session protocols this app takes.
constexpr int LEAST_PROTOCOL = 1;
constexpr int MOST_PROTOCOL = 1;

// The cloud the build names, its snapshot host, the app's version, the service its token is kept under, and the
// platform and its version as the device sign-in names them, as "ios" and "27.1".
struct Config {
    std::string api;
    std::string snapshots;
    std::string version;
    std::string service;
    std::string platform;
    std::string system;
};
const Config &config();

struct Account {
    std::string id;
    std::string name;
};

// A session of the account's list, as crossbind cloud gives it with its key: a dev server's, at its addresses, or a
// snapshot's, at its version.
struct Session {
    std::string id;
    std::string source;
    std::string projectId;
    std::string projectName;
    std::vector<std::string> addresses;
    int protocol = 0;
    std::string key;
    int version = 0;
    std::string createdAt;
};

// preview.cpp: the account signed in and its token, read from the system's store once; none signed in, an empty token.
void withAccount(std::function<void(std::optional<Account> account, std::string token)> fn);
// Keeps the account and its token, in the system's store where it takes them, then runs done with whether it did.
void keepSignIn(Account account, std::string token, std::function<void(bool isKept)> done);
// Forgets the account, its token and list, ends the preview open, and deletes the token from the store.
void forgetSignIn(std::function<void()> done);
bool hasKeyring();
// The account's list as it was read last, and a session of it.
void keepList(std::vector<Session> sessions);
std::optional<Session> listed(const std::string &id);
void dropListed(const std::string &id);
// Each snapshot's version as it was opened last, from the app's data folder.
std::optional<int> openedVersion(const std::string &id);
void noteOpened(const std::string &id, int version);
// A file of the extension's own in the app's data folder, as preview/versions.json: its text, none where it cannot be
// read; and its text written whole, which a read sees all of or none of: why it could not be, or none.
std::optional<std::string> readDataFile(const std::string &name);
Failure writeDataFile(const std::string &name, const std::string &text);
// Holds the event preview.<name> for the app's page, which asks for it with events.held() as it loads.
void holdEvent(const std::string &name, const Value &value);

// opener.cpp: the preview open, ended, its window shows the app's first page again, and the words the page hears of
// why, where the extension ended it of itself; a session id ends only that session's. Whether one ended.
bool endPreview(const std::string &words = {}, const std::string &session = {});
// The preview open ended and the session checked last forgotten, as the account signs out.
void forgetOpener();
void addOpenerFunctions(crossbind::Registry &registry);
// What the preview's menu does, and Back on Android: the preview's page reloaded by the web view's own reload, a
// snapshot's once its session is read again; and the preview ended, the event preview.ended held with no words.
void reloadPreview();
void closePreview();
// A snapshot's session read again as the app comes to the front: a higher version, its proof holding, reloads its page.
void readPreviewAgain();

// indicator.cpp: what shows that a preview is one, on each window a project's page shows in: the pill on a phone, on a
// desktop the window's title and the preview's menu. It is up on a window before the project's page can load there,
// and down once the preview ended and the window's next page that is no project's started; the app's own page that
// comes to show in a window whose preview is open ends that preview. Each mark is of the preview serve() numbered: an
// end or a line of another preview changes nothing of it.
struct Shown {
    std::string project;
    std::string line;
    // The preview's origin, by which Android's Java tells the WebView's pages.
    std::string origin;
};
// The preview of this number up on the window of this id, 0 for the app's oldest, with these words, then runs then with
// the window it is on.
void markPreview(uint64_t preview, uint64_t window, Shown shown, std::function<void(uint64_t window)> then);
// The preview of this number ended: each window's indicator of it comes down, at once where its page is no project's.
void unmarkPreview(uint64_t preview);
// The menu's line of the preview of this number, as what it serves changed.
void relineIndicator(uint64_t preview, std::string line);
void addIndicatorHooks(crossbind::Registry &registry);
// The platform's own, apple.mm, windows.cpp, linux.cpp and android.cpp, each on the main thread, Android's on its
// Java's UI thread: the window's indicator up with these words, or its words changed; down; at the preview's end,
// whether the window shows a page of the preview's origin, whose indicator then comes down with the window's next
// page; and the window's page reloaded.
void showIndicator(uint64_t window, const Shown &shown, std::function<void()> done);
void hideIndicator(uint64_t window);
void endIndicator(uint64_t window, std::function<void(bool isShowingProject)> done);
void reloadWindow(uint64_t window);
#if defined(__ANDROID__)
// android.cpp: what the Java's pill and Back ask of the preview, Reload or Close preview, waited for one at a time.
void listenToMenu();
#endif

// requests.cpp: what a page asks to use and the files dropped on it, by the page's role, as the holder of the host's
// page-permissions and page-drops.
void addPageRequests(crossbind::Registry &registry);

// consents.cpp: the camera, the microphone and the location a project's page asks for, which its user allows at the
// app's own question or not, for the preview the extension serves: its origin's URL, the origin's name its answers are
// kept under, and the project's name from the account's list, which the question shows. then runs once whatever takes
// the page's requests knows it. The preview's end closes the question unanswered and denies what waits for it.
struct Served {
    std::string url;
    std::string name;
    std::string project;
};
void serveConsents(Served served, std::function<void()> then);
void endConsents();
#if !defined(__ANDROID__)
// A request of a page whose role is a served origin's, which the extension's own question decides; Android's are its
// Java's.
void askConsent(crossbind::PagePermission request);
// The platform's own question over the window of this id, the app's oldest for 0, on the main thread: modal to that
// window alone, its default button Don't Allow, its two buttons its only way out. done gets whether its user pressed
// Allow, once, on the main thread, or none where it could not be shown; the function it gives closes it unanswered,
// from any thread, as a Windows task dialog holds the main thread's queue, and done hears nothing of that.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done);
#endif

// cloud.cpp: a call of crossbind cloud's, with the app's token where one is given: done gets why it failed, or its
// status and its answer's JSON, null for none or for one that is no JSON.
void askCloud(const std::string &method, const std::string &path, const std::string &token, const std::string &body,
    std::function<void(Failure failure, int status, Value answer)> done);
std::optional<Session> sessionOf(const Value &value);
// The words a refusal of the cloud's carries, or these where it carries none.
std::string cloudWords(const Value &answer, const std::string &otherwise);
void addCloudFunctions(crossbind::Registry &registry);

// values.cpp: JSON, base64url, the forms a value takes before it reaches a URL or an origin, and the account's words.
Value parseJson(const std::string &text);
std::string textOf(const Value &value);
std::optional<int> integerOf(const Value &value);
std::string toBase64url(const std::string &bytes);
std::optional<std::string> fromBase64url(const std::string &text);
bool isSessionId(const std::string &text);
bool isKey(const std::string &text);
bool isLocalAddress(const std::string &address);
bool isListedName(const std::string &name);
bool isSameSecret(const std::string &given, const std::string &expected);
std::string hexOf(const std::string &bytes);
std::string escapedPath(const std::string &path);
// The session a link opens: its id for a link of crossbind.dev/open or of the app's scheme, "" for such a link that names
// none, and none for any other link.
std::optional<std::string> linkedSession(const std::string &url);
std::string signedOutWords();
std::string emptyListWords(const std::string &account);
std::string notListedWords(const std::string &account);
std::string otherAccountWords(const std::string &where, const std::string &other, const std::string &account);

// The platform's own: apple.mm, windows.cpp, linux.cpp and android.cpp.
void hmacSha256(const std::string &key, const std::string &text, Digest done);
void sha256(const std::string &text, Digest done);
std::string randomBytes(std::size_t count);
void readSecret(const std::string &cloud, std::function<void(Failure failure, std::optional<std::string> secret)> done);
void writeSecret(const std::string &cloud, const std::string &secret, Done done);
void deleteSecret(const std::string &cloud, Done done);
void openSignInPage(const std::string &url, Done done);
// Its name and version as crossbind cloud's sign-in takes them, read once, on the main thread, as the entry runs.
std::string platformName();
std::string systemVersion();
// Whether the system holds the app's first connections to the local network back until its user allows them.
bool asksForLocalNetwork();

}  // namespace preview

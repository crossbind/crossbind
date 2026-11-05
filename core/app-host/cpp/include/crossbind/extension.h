#pragma once

// What an app's host gives the native code it compiles in: functions the page calls by name through crossbind/app,
// whose options, messages and results are JSON values and bytes, URLs the page loads, and what the code does as the app
// is launched, opens a link and quits. The host's own functions are added the same way.
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#ifdef __APPLE__
#include <TargetConditionals.h>
#endif

// The newest version of the contract between crossbind and its extensions this host is built for, which an extension's
// crossbind.extension.js names: one written for several tells them apart with it, as #if CROSSBIND_EXTENSION_CONTRACT >=
// 2 does.
#define CROSSBIND_EXTENSION_CONTRACT 1

namespace crossbind {

namespace app {
// How the host makes what it hands an extension, which no extension makes.
struct RegistryAccess;
}  // namespace app

// A JSON value, or bytes, which a call carries beside JSON: what a typed array, a DataView or an ArrayBuffer of the
// page's holds, and the page gets as a Uint8Array. It never changes, so any thread may hold a copy.
class Value {
public:
    using Array = std::vector<Value>;
    // The members in their order, as JSON.stringify writes them.
    using Object = std::vector<std::pair<std::string, Value>>;
    using Bytes = std::vector<std::uint8_t>;

    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool value) : data_(value) {}
    Value(int value) : data_(static_cast<double>(value)) {}
    Value(double value) : data_(value) {}
    // Null for a null pointer.
    Value(const char *text) {
        if (text) data_ = std::string(text);
    }
    Value(char *text) : Value(static_cast<const char *>(text)) {}
    // Another pointer is no JSON value, which would be read as a boolean.
    template <typename T>
    Value(T *) = delete;
    Value(std::string text) : data_(std::move(text)) {}
    Value(const std::vector<std::string> &texts) : Value(Array(texts.begin(), texts.end())) {}
    Value(Array items) : data_(std::make_shared<const Array>(std::move(items))) {}
    Value(Object members) : data_(std::make_shared<const Object>(std::move(members))) {}
    Value(Bytes bytes) : data_(std::make_shared<const Bytes>(std::move(bytes))) {}

    bool isNull() const { return std::holds_alternative<std::monostate>(data_); }
    bool isBool() const { return std::holds_alternative<bool>(data_); }
    bool isNumber() const { return std::holds_alternative<double>(data_); }
    bool isString() const { return std::holds_alternative<std::string>(data_); }
    bool isArray() const { return std::holds_alternative<std::shared_ptr<const Array>>(data_); }
    bool isObject() const { return std::holds_alternative<std::shared_ptr<const Object>>(data_); }
    bool isBytes() const { return std::holds_alternative<std::shared_ptr<const Bytes>>(data_); }

    // Each throws when the value is of another kind; given a fallback, it returns that for null.
    bool asBool() const;
    bool asBool(bool fallback) const;
    double asNumber() const;
    double asNumber(double fallback) const;
    const std::string &asString() const;
    std::string asString(std::string fallback) const;
    const Array &asArray() const;
    const Object &asObject() const;
    const Bytes &asBytes() const;
    // An object's member, or null when it has none or is no object.
    const Value &operator[](std::string_view key) const;
    // Its JSON text; bytes, which JSON has none of, throw.
    std::string json() const;

private:
    std::variant<std::monostate, bool, double, std::string, std::shared_ptr<const Array>, std::shared_ptr<const Object>,
        std::shared_ptr<const Bytes>>
        data_;
};

// A page of the app's, from its start, as onPage tells, until the next replaces it, as a reload does: its id within the
// run, never 0, and that of the window it is in. A call of the app's own code is of no page, 0 for both; an Android
// page is of no window an extension reaches, 0.
class Page {
public:
    uint64_t id() const { return id_; }
    uint64_t windowId() const { return windowId_; }

private:
    friend struct app::RegistryAccess;
    Page(uint64_t id, uint64_t windowId) : id_(id), windowId_(windowId) {}

    uint64_t id_;
    uint64_t windowId_;
};

// A window of the app's, which onWindow and onWindowClosed get, for the main thread while it is open: its id within
// the run, from 1, the platform's window, an NSWindow on macOS, a UIWindow on iOS, a GtkWindow on Linux and an HWND on
// Windows, and its webview, as appWebView() tells of the first window's.
class Window {
public:
    uint64_t id() const { return id_; }
    void *native() const { return native_; }
    void *webView() const { return webView_; }
    // The page it shows now, which a reload replaces, from any thread: of id 0 before its first and once it closed.
    Page page() const;

private:
    friend struct app::RegistryAccess;
    Window(uint64_t id, void *native, void *webView) : id_(id), native_(native), webView_(webView) {}

    uint64_t id_;
    void *native_;
    void *webView_;
};

// A call of the page's, which its function answers once, from any thread: with a result, or with why it failed. A call
// that every copy lets go of unanswered fails. Before its answer, it may send the page messages; the page may cancel it,
// and a page that another replaces, as a reload does, cancels each of its calls.
class Call {
public:
    const std::string &name() const;
    const Value &options() const;
    // Whether the page made the call; invoke() makes the rest, for the app's native code, which reaches more than the page
    // may.
    bool isFromPage() const;
    // The page that made it, which is none for a call of the app's own code.
    Page page() const;
    void resolve(Value result = {}) const;
    void reject(const std::string &message) const;
    // A message for the onMessage the page passed invoke(), from any thread: the page gets each in the order they were
    // sent, and all of them before the answer. One after the answer or the cancel goes nowhere, as does each of a call
    // whose page passed no onMessage, and of one the app's own code made.
    void send(Value message) const;
    // Runs fn once, on the module's thread, which it must not hold up, as the page cancels the call through the signal
    // it passed invoke(), or goes away: the call answers nothing from then on. Each fn given runs, in the order given.
    // For a call cancelled already, fn runs at once, on the caller's thread; for one answered, never, and the call lets
    // go of it.
    void onCancel(std::function<void()> fn) const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit Call(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A request of the page's for one of an extension's URLs, as crossbind/app's routeUrl() names them:
// crossbind://app/ext/<extension>/<path>, on Android https://appassets.androidplatform.net/ext/<extension>/<path>. Its
// owner answers it once, from any thread; one that every copy lets go of unanswered gets 500. Any of the app's pages
// may load the URL, as it loads the page's own files, without the token its calls carry.
class Request {
public:
    using Headers = std::vector<std::pair<std::string, std::string>>;

    // GET or HEAD: the host answers any other method itself, with 405.
    const std::string &method() const;
    // What follows the extension's name, decoded, from its "/", as "/clips/intro.mp4": never with a part "..", nor an
    // empty one, and on Windows never with a \ or a :, so it joins to a folder within it.
    const std::string &path() const;
    // What follows the "?", as the URL has it, undecoded, as "size=256"; empty without one.
    const std::string &query() const;
    // The value of the request's header of this name, in any case, or "" without one.
    std::string header(std::string_view name) const;
    // The page that asks.
    Page page() const;
    // Answers with body, of the type a Content-Type header names, application/octet-stream without one; a HEAD gets the
    // headers alone. A webview follows no redirect of an app's URLs, so status is not 3xx.
    void respond(int status, const Headers &headers = {}, std::string body = {}) const;
    // Answers with the file at path, which the host reads on a thread of its own, of the type its extension names, as
    // for the page's files: the part a Range header asks for, as 206, up to 4 MiB of it, from where the webview asks
    // for more; the whole file otherwise; 404 for no regular file there.
    void respondFile(const std::string &path) const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit Request(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A desktop app's launch: its arguments without the program's own, the folder it was launched in, and what lets a Linux
// window take the front from another app: the launch's Wayland activation token or X11 startup id.
struct Launch {
    std::vector<std::string> args;
    std::string cwd;
    std::string token;
};

// A link the system opens the app with, which is whatever the system hands the app, so its owner takes it as it would
// any address from outside.
struct OpenUrl {
    std::string url;
};

// Files the system opens the app with at once, by their absolute paths, each with the MIME type it came with: an
// Android file's, which named its owner before its name did, and "" elsewhere.
struct OpenFiles {
    std::vector<std::string> paths;
    std::vector<std::string> mimeTypes;
};

// A tap of one of the quick actions of an iOS or Android app's icon, by its type.
struct ShortcutItem {
    std::string type;
};

// A user activity the system continues an iOS or macOS app with: its type, what the app that made it keeps in its
// userInfo, an object of a property list's values as JSON values and bytes, a date as its ISO 8601 text, a URL and a
// UUID as theirs and a set as an array, and the web page a device without the app opens instead, if any.
struct UserActivity {
    std::string type;
    Value userInfo;
    std::string webpageUrl;
};

// The app's push token, as the platform's push service knows the app by, which the extension's provider sends its
// pushes to: as text, on Apple's platforms the APNs device token in lowercase hex.
struct PushToken {
    std::string token;
};

// Why the system gave the app no push token.
struct PushTokenFailure {
    std::string message;
};

// The files the app's user dropped on the page at once, by their absolute paths, at the page's point, in CSS pixels
// from its top left, and the page they were dropped on.
struct Drop {
    std::vector<std::string> paths;
    double x = 0;
    double y = 0;
    Page page;
};

// How a download ended: the path it was saved at, on Android after ask() the content: URI of the picker's; or that it
// was cancelled, before an answer or after one; or why it failed, as the system tells it.
struct DownloadEnd {
    std::string path;
    bool isCancelled = false;
    std::optional<std::string> failure;
};

// How the system shows a notification while an iOS or macOS app is in front: as a banner, in Notification Center's
// list, with its sound and with its badge on the app's icon.
struct NotificationPresentation {
    bool banner = true;
    bool list = true;
    bool sound = true;
    bool badge = false;
};

// A notification of an iOS or macOS app's, its own or a push, which the system shows while the app is in front or which
// its user answered: its request's identifier, its title and body, and what its sender put in its userInfo, as a user
// activity's userInfo is. Any thread may hold a copy.
class Notification {
public:
    const std::string &id() const;
    const std::string &title() const;
    const std::string &body() const;
    const Value &payload() const;
    // Whether it came as a push, not from the app itself.
    bool isRemote() const;
    // Whether its user answered it, by a tap, an action or dismissing it; else the system is to show it while the app
    // is in front.
    bool isAnswered() const;
    // Whether its user tapped it, which opened the app.
    bool isTap() const;
    // Whether its user dismissed it, which a notification of a category with a dismiss action tells.
    bool isDismissed() const;
    // The identifier of another action its user answered it with, as one of its category's, or empty for none.
    const std::string &action() const;
    // How the system shows one while the app is in front, as the first hook that calls it decides, while the hooks
    // run; without one, as a banner, in the list and with its sound. Of no effect on one its user answered.
    void present(NotificationPresentation presentation) const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit Notification(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// The answer of an extension's onPushMessage to a silent push on iOS, which any thread gives once: newData() as the
// extension fetched what the push told of, noData() as there was none, failed() as it could not. One let go of
// unanswered answers noData(); macOS takes none.
class PushDone {
public:
    void newData() const;
    void noData() const;
    void failed() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit PushDone(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

#if !defined(__ANDROID__)
// A dialog the page opened with alert(), confirm() or prompt(), which its owner answers once, from any thread, as the
// page waits: accept() is an alert's or a confirm's OK, or the text a prompt gives, cancel() a confirm's or a prompt's
// Cancel, and useDefault() leaves it to the webview, which shows its own on Linux where the owner calls it before its
// hook returns, and else cancels it. A dialog that every copy lets go of unanswered is cancelled.
class PageDialog {
public:
    enum class Kind { alert, confirm, prompt };

    Kind kind() const;
    const std::string &message() const;
    // The text prompt() offers to change; empty for the others.
    const std::string &defaultText() const;
    // The page that opened it.
    Page page() const;
    void accept(const std::string &text = {}) const;
    void cancel() const;
    void useDefault() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit PageDialog(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// What the page asks to use, which its owner allows or denies once, from any thread, as the page waits, or leaves to the
// webview with useDefault(): WebKit asks its user on Apple's platforms and WebView2 on Windows, and WebKitGTK denies it.
// A request that every copy lets go of undecided is denied.
class PagePermission {
public:
    // What it asks for, together: "camera", "microphone", "location", "clipboard", the webview's others by the names
    // crossbind gives them, as "notifications", "midi" or "fonts", and "unknown" for one it names none of.
    const std::vector<std::string> &kinds() const;
    // The origin of the frame that asks, as "crossbind://app"; on Linux the page's, as WebKitGTK names no frame.
    const std::string &origin() const;
    // Whether app.permissions lists each of the devices it asks for; false for a kind that is no device.
    bool isListed() const;
    // The page that asks.
    Page page() const;
    void allow() const;
    void deny() const;
    void useDefault() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit PagePermission(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A file input the page's user clicked, which its owner answers once, from any thread, with the paths of what its user
// picked, or with none when they cancelled; useDefault() leaves it to the webview, which shows its own picker on Linux
// where the owner calls it before its hook returns, and else cancels it. One that every copy lets go of unanswered is
// cancelled.
class FileInput {
public:
    bool allowsMultiple() const;
    // Whether it takes folders, as one with webkitdirectory does.
    bool allowsFolders() const;
    // The types its accept attribute names, as "image/*" or ".png", where the webview tells them: macOS's tells none.
    const std::vector<std::string> &accept() const;
    // The page whose input it is.
    Page page() const;
    void pick(const std::vector<std::string> &paths) const;
    void cancel() const;
    void useDefault() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit FileInput(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};
#endif

// What the owner of the page's navigations answers one with: load it in the app; open it in the system's browser, or
// its mail app, http, https and mailto alone, another being refused; refuse it; or do as without an owner, which
// refuses it.
enum class NavigationAnswer { load, openOutside, refuse, useDefault };

// A navigation of the page's to a URL beyond the app's own origins, which load without asking, which its owner answers
// as its hook returns. A page another origin loads in the app reaches none of the app's functions. Android's WebView
// asks about no frame's first load, which goes on without one.
class Navigation {
public:
    const std::string &url() const;
    // Whether it loads the top frame, not one of the page's frames; WebKitGTK tells no frame, so always on Linux.
    bool isMainFrame() const;
    // Whether the page's user asked for it, as with a click on a link.
    bool isUserInitiated() const;
    // Whether the page asked for a window of its own, as window.open() and a link of target="_blank" do: the app opens
    // no window of the page's, and load loads it in the page's place. One at the app's own origins opens nowhere,
    // without asking, and Android's WebView loads such links in place itself.
    bool isNewWindow() const;
    // The page that navigates.
    Page page() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit Navigation(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A server's ask for a user's name and password, as HTTP's Basic, Digest and NTLM authentication and a proxy's are, for
// a request of the page's: its owner answers it once, from any thread, and useDefault() cancels it, as without an
// owner; one that every copy lets go of unanswered is cancelled, and the page gets what the server answers to that.
class HttpAuthentication {
public:
    // The server's host, with its port, as an origin names it; Android's WebView names no port.
    const std::string &host() const;
    // The realm it names, or "" where the webview tells none.
    const std::string &realm() const;
    // Whether a proxy asks, where the webview tells: never on Windows and Android.
    bool isProxy() const;
    // The page whose request it is.
    Page page() const;
    void answer(const std::string &user, const std::string &password) const;
    void cancel() const;
    void useDefault() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit HttpAuthentication(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A request of the page's to a server whose certificate the system does not trust: its owner answers it once, from any
// thread, and useDefault() refuses it, as without an owner; one that every copy lets go of unanswered is refused, and
// the request fails. Android's WebView refuses each without asking, as Android asks of an app.
class CertificateError {
public:
    // The request's URL; on Apple's platforms, which tell no more, its origin.
    const std::string &url() const;
    // The server's host, with its port, as an origin names it.
    const std::string &host() const;
    // What is wrong with the certificate, as a sentence: the system's own on Apple's platforms.
    const std::string &reason() const;
    // The page whose request it is.
    Page page() const;
    // Loads the page all the same, and the host's other pages with this certificate, as long as the app runs.
    void trust() const;
    void refuse() const;
    void useDefault() const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit CertificateError(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// A download the page starts, as a link with a download attribute does, or a response the webview cannot show: its
// owner answers it once, from any thread, before any of it is saved; one that every copy lets go of unanswered is
// cancelled.
class Download {
public:
    const std::string &url() const;
    // The file's name, as the page's link or the server names it, or as the URL ends.
    const std::string &suggestedName() const;
    // Its MIME type, or "" where the webview tells none.
    const std::string &mimeType() const;
    // Its size in bytes, or -1 where the server tells none.
    int64_t size() const;
    // The page that starts it.
    Page page() const;
    // Saves it at this absolute path, which it replaces once all of it has arrived; a path that is not absolute, or a
    // folder's, throws.
    void saveTo(const std::string &path) const;
    // Saves it as the host does without page-downloads: where the app's user picks, in macOS's save panel, iOS's
    // export sheet and Android's save picker; in the user's Downloads folder on Linux; through WebView2's own downloads
    // on Windows.
    void ask() const;
    // Refuses it before an answer, and stops it after one.
    void cancel() const;
    // Saves it as without an owner, as ask() does.
    void useDefault() const;
    // fn gets the bytes that have arrived and its size, -1 where the server tells none, on the main thread as they
    // arrive, at most every 100 ms. Android's page hands a download over whole, so fn hears nothing there.
    void onProgress(std::function<void(int64_t received, int64_t size)> fn) const;
    // fn gets, once on the main thread, how it ended. A function of either that holds the download keeps it from being
    // cancelled as every other copy lets it go unanswered.
    void onFinish(std::function<void(const DownloadEnd &end)> fn) const;

private:
    friend struct app::RegistryAccess;
    struct State;
    explicit Download(std::shared_ptr<State> state) : state_(std::move(state)) {}

    std::shared_ptr<State> state_;
};

// What an extension sends the pages as events, each named after the extension, as clipboard.changed is an event changed
// of the extension clipboard's: a page's listeners of that name get its value through crossbind/app's events.on(). Any
// thread may hold a copy and send. emit() reaches every page that listens to the name, or the one page given;
// emitToFront() the page in front that listens, of the window its user used last, for what one page is to act on once.
// hold() keeps each until a page asks for the events of its name with events.held(), as what came before it listened,
// then hands it to the page in front that asked. A value with bytes, which JSON has none of, throws; so does an empty
// name.
class Events {
public:
    void emit(const std::string &name, const Value &value = {}) const;
    void emit(const std::string &name, const Value &value, const Page &page) const;
    void emitToFront(const std::string &name, const Value &value = {}) const;
    void hold(const std::string &name, const Value &value = {}) const;

private:
    friend class Registry;
    explicit Events(std::string extension) : extension_(std::move(extension)) {}

    std::string extension_;
};

// What an extension adds to the app, as its entry runs on the main thread when the app starts, before the app's module.
// The entry adds what the extension does and starts nothing, as every launch runs every entry, one that another instance
// then takes as well: what the extension starts as the app runs, it starts in onStart. The registry lives as long as the
// entry runs: what a function keeps of it, as its options, it keeps a copy of.
//
// An extension takes roles of the host's own, which its crossbind.extension.js names in replaces: those of the host's
// menu, menu, tray and notification, of its page-navigation, page-navigation and page-authentication, and of each other
// host's extension its own name, as dialog or page-downloads. The host's extension that held a role an app's extension
// takes keeps its others.
class Registry {
public:
    using Function = std::function<void(Call)>;

    Registry(const Registry &) = delete;
    Registry &operator=(const Registry &) = delete;

    // A function the page calls by this name, which starts with the extension's own and a dot, as clipboard.readText,
    // or with a role's it holds, as tray.set for the holder of tray. It runs on the module's thread for the page's calls,
    // which it must not hold up: it answers there, or hands the call on, as to inBackground(). A call of the app's own,
    // through invoke(), runs it on the caller's thread, so it may run on several at once. What it throws fails the call.
    void function(const std::string &name, Function fn);
    // Answers the page's requests for the extension's URLs: fn gets each GET and HEAD on the thread the webview asks on,
    // the main thread but on Android, where it is one of the WebView's, which waits for the answer, and several may ask
    // at once: fn must not hold it up, and answers there or hands the request on, as respondFile() does to a thread of
    // its own. What fn throws answers 500. An extension has one route.
    void route(std::function<void(Request)> fn);
    // The extension's options, a JSON value: what crossbind.config.js lists it with, or for a host's own extension the
    // app's options it takes; null without any. A copy, which outlives the registry, as its functions do. An extension
    // that takes a role of the host's gets its own options alone, of which it leaves out what it knows nothing of.
    Value options() const { return options_; }
    // The folder of the files the extension carries, as its app.files and app.<platform>.files list them, each in the
    // place it had in the extension's folder: read-only, within the app. Android's are copies on disk, which the app
    // makes as it first starts after each install. A copy, which outlives the registry.
    std::string files() const;
    // What the extension sends the page as its events, which outlives the registry.
    Events events() const { return Events(extension_); }
    // Takes the app's launches, as one extension alone does: fn gets this process's on the main thread, before the
    // app's module starts. false ends the launch with exit status 0, as when the instance that runs took it; what fn
    // throws ends it with status 1 and says why, in a message box as well when the app's user opened it. Desktop apps
    // alone call fn: iOS and Android keep an app to one instance themselves.
    void onLaunch(std::function<bool(const Launch &)> fn);
    // Runs fn once, on the main thread, as the app starts, once every extension's entry ran and the launch is the
    // app's, before its module starts and its first window opens: where the extension starts what it does as the app
    // runs, and holds what the page is to hear of first. A launch that onLaunch ends never calls it. Android's UI thread
    // runs it as the activity first starts. What fn throws ends the app, which runs every extension's onQuit.
    void onStart(std::function<void()> fn);
    // Run fn on the main thread as each window of the app's opens, before its page loads, and as it closes, while it is
    // there. A desktop app opens its first window as it starts and each the page opens with crossbind/app's
    // windows.open(), and they close as their user closes them, and all as the app quits, before onQuit; an iOS app opens
    // one for each scene that connects, which closes as its scene disconnects; an Android app has none an extension
    // reaches, and calls neither. An app that fails runs onQuit alone.
    void onWindow(std::function<void(const Window &window)> fn);
    void onWindowClosed(std::function<void(const Window &window)> fn);
    // Runs fn on the module's thread as each page of the app's starts, the first one and each that replaces the page
    // before it, as a reload does: once the calls of the page before have reached their functions, before the new
    // page's do. Where the extension lets go of what it kept for the page before, whose calls get no answer from then
    // on. A load may start more than one page, each of an id of its own.
    void onPage(std::function<void(const Page &page)> fn);
    // Asks fn on the main thread as a window of the app's closes on the desktop, as its user closes it, the page's
    // windows.close() does, or on Windows and Linux another program, as taskkill without /F does: false keeps the window
    // open, as an app that stays in its tray, which hides the window itself, and asks no other extension; what fn throws
    // lets it close. The app quits as its last window closes. A window that closes with its parent goes without asking,
    // as do all as app.quit() closes them; the menu's quit item and the system's own quit, as from the macOS Dock, ask
    // onQuitRequest instead. A phone's app has no window its user closes, and iOS closes an iPad's without asking fn.
    void onClose(std::function<bool(const Window &window)> fn);
    // Runs fn on the main thread with whether the app is before its user, once its first window has opened, and again as
    // that changes: true as it becomes the active app on the desktop or comes to a phone's foreground, false as another
    // app takes its place, or a phone's is interrupted, by a call, a system alert or another app's picker, or goes to the
    // background. A Linux app is active while one of its windows has the focus, which a dialog of its own takes as well. The page hears each
    // change as the events active and inactive. fn returns at once: a modal loop in it lets the next change through
    // first.
    void onActive(std::function<void(bool isActive)> fn);
    // Asks fn on the main thread as the app's user or its system asks the app to quit, other than by closing its window:
    // macOS's Quit, as ⌘Q, the Dock's and logging out do, the end of a Windows session, but for the Restart Manager's,
    // which closes the app to service the system, and the menu's quit item and the page's app.requestQuit(), which
    // <crossbind/app.h>'s requestQuit() asks from native code. false keeps the app running, and asks no other
    // extension; what fn throws lets it quit. fn answers at once: one that asks its user returns false, asks, and on
    // their answer quits with quit(), as requestQuit() would ask it again. app.quit(), a relaunch and an update quit
    // without asking, and Linux's and a phone's system ask nothing.
    void onQuitRequest(std::function<bool()> fn);
    // Runs fn on the main thread as the app's user opens the app that runs again, on macOS: a click of its Dock icon, or
    // open with no file or link. The host shows the app's window first, as one an app in its tray hid.
    void onReopen(std::function<void()> fn);
    // Runs fn once as the app quits or fails, before its module stops: on the main thread as it quits, on the thread
    // that fails it as it fails; never in a launch that onLaunch ends, nor in one whose extensions' entries fail.
    // Android and, at times, iOS end an app without either.
    void onQuit(std::function<void()> fn);
    // Gets each link of the schemes the extension's app.urlSchemes declares, and on iOS and Android each https link of
    // its app.links, wherever the system hands it over, on the main thread, one at a time, in the order the system
    // hands them over. The host tells the page of none of them. An extension that declares schemes calls it, as does one
    // that declares links on iOS and Android, and one that calls it declares them; the holder of the links' role gets
    // those of app.urlSchemes and app.links.
    void onOpenUrl(std::function<void(const OpenUrl &open)> fn);
    // Gets the files the system opens the app with whose extension the extension's app.fileTypes declares, wherever it
    // hands them over, on the main thread, one opening at a time: those of a launch, a desktop launch's arguments among
    // them, as app.md tells, and those a running app is handed. An iOS app gets a document where it is, which it may
    // read and write as long as it runs, and an Android app one file an opening, a copy in its cache, of the name it
    // had, which goes to the owner of the MIME type it came with before the owner of its name's extension. The host
    // tells the page of none of them. An extension that declares file types calls it, and one that calls it declares
    // them; the holder of the files' role gets those of app.fileTypes, and those no extension's type takes.
    void onOpenFiles(std::function<void(const OpenFiles &open)> fn);
    // Gets each user activity the system continues an iOS or macOS app with whose type the extension's
    // app.activityTypes declares, as Handoff from another of its user's devices hands it over, on the main thread, the
    // launch's own among them: true takes it, and false tells macOS its user is to hear it could not be continued. A
    // web page's, a site's link, goes to onOpenUrl. The host tells the page of none of them. An extension that declares
    // types calls it on Apple's platforms, and one that calls it declares them; the holder of the activities' role gets
    // those of app.activityTypes. Another platform continues none.
    void onUserActivity(std::function<bool(const UserActivity &activity)> fn);
    // Gets each tap of a quick action of the app's icon that the extension's app.shortcutItems declares, on iOS and
    // Android, the launch's own among them, on the main thread: true takes it, which iOS hears. The host tells the page
    // of none of them. An extension that declares quick actions calls it on the phones, and one that calls it declares
    // them; the holder of the shortcuts' role gets those of app.shortcutItems. A desktop has none.
    void onShortcutItem(std::function<bool(const ShortcutItem &item)> fn);
    // Gets each notification of an iOS or macOS app's, its own and pushes alike, as the system shows one while the app
    // is in front and as its user answers one, the tap that launched the app among them, on the main thread: every
    // extension's fn hears of each, in the extensions' order. The host is the delegate of the system's notification
    // center, which an extension leaves as it is: it asks for authorization and adds its requests itself, and its
    // categories with addNotificationCategories(). Another platform calls fn with none.
    void onNotification(std::function<void(const Notification &notification)> fn);
    // Get the app's push token on iOS and macOS once registerForPush() asked for it, or why the system gave none, and
    // each silent push the app gets, its payload as a notification's, on the main thread: every extension's fn hears of
    // each. iOS waits for each onPushMessage's answer, 25 s at most, and hears them as one: newData where one gave it,
    // else failed where one gave that, else noData. Another platform calls none of them.
    void onPushToken(std::function<void(const PushToken &token)> fn);
    void onPushTokenFailure(std::function<void(const PushTokenFailure &failure)> fn);
    void onPushMessage(std::function<void(const Value &payload, PushDone done)> fn);
    // Takes the page's navigations beyond the app's origins, as the holder of the page-navigation role alone does: the
    // host's own loads the origins app.navigation.load lists, opens a link its user follows elsewhere outside and
    // refuses the rest. fn answers each on the main thread as it returns. Without an owner, the app loads nothing beyond
    // its origins.
    void onNavigation(std::function<NavigationAnswer(const Navigation &navigation)> fn);
    // Take the HTTP authentications and certificate errors of the page's requests, as the holder of the
    // page-authentication role alone does: the host's own takes neither. fn gets each on the main thread. Without an
    // owner, the app cancels each authentication and refuses each certificate error.
    void onHttpAuthentication(std::function<void(HttpAuthentication)> fn);
    void onCertificateError(std::function<void(CertificateError)> fn);
    // Takes the page's downloads, as the holder of the page-downloads role alone does: the host's own saves each as
    // ask() does. fn gets each on the main thread. Without an owner, each saves as ask() does.
    void onDownload(std::function<void(Download)> fn);
    // Takes the files the app's user drops on a page of the app's origins, on the desktop, as the holder of the
    // page-drops role alone does: fn gets each drop on the main thread, as the page's own drop event goes on. The host's
    // own tells the page, as the event drop, and lets it reach each path as one its user picked.
    void onDrop(std::function<void(const Drop &drop)> fn);
#if !defined(__ANDROID__)
    // Take the page's dialogs, what it asks to use and its file inputs, each as the holder of its role alone does:
    // page-dialogs, page-permissions and page-files, the host's own. fn gets each on the main thread. Without one, the
    // webview does as it would: WebKit on Apple's platforms answers a dialog as cancelled and shows no picker, WebKitGTK
    // and WebView2 show their own. No extension takes an iOS or a Windows app's file inputs, whose webview shows its own
    // picker. Android's are its extensions' Java's, as its WebView asks for them in Java.
    void onPageDialog(std::function<void(PageDialog)> fn);
    void onPagePermission(std::function<void(PagePermission)> fn);
    void onFileInput(std::function<void(FileInput)> fn);
#endif

private:
    friend struct app::RegistryAccess;
    // The host's registry of its own functions, and of one extension, which knows it by its name, with the roles of the
    // host's it holds and, for one of the host's own, those an app's extension took, whose functions and hooks it leaves.
    Registry() = default;
    Registry(std::string extension, Value options, std::vector<std::string> roles, std::vector<std::string> given)
        : extension_(std::move(extension)), options_(std::move(options)), roles_(std::move(roles)), given_(std::move(given)) {}

    std::string extension_;
    Value options_;
    std::vector<std::string> roles_;
    std::vector<std::string> given_;
};

// Runs work on a thread of its own, which answers the call with what work returns, or with what it throws.
void inBackground(Call call, std::function<Value()> work);

// Calls one of the app's functions by its name, as the page does, from any thread once the app's extensions have all
// started: the function runs on the caller's thread, and its call is no page's, so isFromPage() is false. done gets
// why the call failed, or its result, once, on the thread that answers: the caller's, before invoke returns, for a
// call that fails at once or that its function answers there.
void invoke(const std::string &name, Value options, std::function<void(std::optional<std::string> failure, Value result)> done);

// The arguments and the working folder the system started the app with, on the desktop, from any thread: the links of
// the app's schemes left out, and in an app that opens files its files, which reach their owners. A phone's app starts
// with none.
Launch launchArgs();

// The app's name, as its window and dialogs show it.
std::string appName();

// The app's id, as app.id gives it: its bundle identifier on Apple's platforms, its application id on Android.
std::string appId();

#ifdef __APPLE__
// Asks the system for the app's push token, on iOS and macOS, from any thread: each extension's onPushToken gets it, or
// its onPushTokenFailure why the system gave none, as to an app without the aps-environment entitlement, which an
// extension's entitlements give.
void registerForPush();
// Adds these categories of notifications, an NSSet of UNNotificationCategory, to those the app's notifications take, on
// iOS and macOS, from any thread: the system's own call would replace the others' with them, while one of an identifier
// another gave takes that one's place here.
void addNotificationCategories(void *categories);
#endif

// The page may reach this file or folder, and what is in a folder, through crossbind/app's shell functions from now
// on, as what its user picked: openPath() where app.openPath lists picked, revealInFolder() and trash(). A path that is
// not absolute is left out.
void allowPath(const std::string &path);
// What allowPath() was given so far, as it was given.
std::vector<std::string> allowedPaths();

#if !defined(__ANDROID__) && !(defined(__APPLE__) && TARGET_OS_IPHONE)
// Hands the app a later launch, which an extension's onLaunch took from another process, from any thread: the app
// brings its window to the front, its page hears of the launch as the event second-instance, each of its links reaches
// the owner of its scheme, and in an app that opens files each of its files the owner of its type, on the main thread.
// A launch that comes before the module has started waits for it.
void launchedAgain(Launch launch);
#endif

#if !defined(__ANDROID__)
// Runs fn on the app's main thread, where the platform's UI is called, after what waits there already, also when the
// caller is on it. A modal loop fn runs, as a dialog's, holds the next until fn returns, but on Linux, where that loop
// runs them. What fn throws is told, and a call fn held fails as it lets go of it. One given as the app quits, as in
// onQuit, may never run.
void onMainThread(std::function<void()> fn);

// The app's oldest open window, on the main thread: an NSWindow on macOS, a UIWindow on iOS, a GtkWindow on Linux and
// an HWND on Windows; null while it has none.
void *appWindow();

// The oldest open window's webview, on the main thread: a WKWebView on macOS and iOS, an ICoreWebView2Controller on
// Windows, and on Linux a WebKitWebView in a vertical GtkBox, which puts the widgets an extension adds to it with
// gtk_container_add above the page at their own height: the window holds the page to its limits, with their height
// added. Null while the app has none. A Linux app is GTK 3's and WebKitGTK 4.1's.
void *appWebView();

// The open window of this id, as a Page's windowId() names it, on the main thread; none for one that closed.
std::optional<Window> windowOf(uint64_t id);
// The app's open windows, the oldest first, on the main thread.
std::vector<Window> openWindows();

// Asks the holder of page-permissions, as the webview does, whether the page of origin may use these kinds: for an
// extension that gives the page what its webview lacks, as the host's page-location gives a macOS page its location.
// From any thread; done gets the answer once, on the main thread, false without page-permissions.
void askPagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(bool isAllowed)> done);
#endif

#if defined(__ANDROID__)
namespace android {

// Calls a function of the extension's Java, the class its app.android.class names, on the UI thread with the app's
// host. done gets the answer once, on the thread that gives it: why the call failed, or its result.
void callJava(const std::string &extension, const std::string &function, Value::Object options,
    std::function<void(std::optional<std::string> failure, Value result)> done);
// Hands a call to a function of the extension's Java, as callJava() above does, with the call's options, an object's
// members or none: the Java's messages reach the call's page, the page's cancel reaches the Java, and its answer answers
// the call.
void callJava(const std::string &extension, const std::string &function, Call call);

}  // namespace android
#endif

}  // namespace crossbind

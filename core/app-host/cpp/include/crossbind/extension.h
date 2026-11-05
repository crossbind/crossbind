#pragma once

// What an app's host gives the native code it compiles in: functions the page calls by name through crossbind/app,
// whose options and results are JSON values, and what the code does as the app is launched, opens a link and quits. The
// host's own functions are added the same way.
#include <cstddef>
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

namespace crossbind {

// A JSON value. It never changes, so any thread may hold a copy.
class Value {
public:
    using Array = std::vector<Value>;
    // The members in their order, as JSON.stringify writes them.
    using Object = std::vector<std::pair<std::string, Value>>;

    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool value) : data_(value) {}
    Value(int value) : data_(static_cast<double>(value)) {}
    Value(double value) : data_(value) {}
    Value(const char *text) : data_(std::string(text)) {}
    Value(std::string text) : data_(std::move(text)) {}
    Value(const std::vector<std::string> &texts) : Value(Array(texts.begin(), texts.end())) {}
    Value(Array items) : data_(std::make_shared<const Array>(std::move(items))) {}
    Value(Object members) : data_(std::make_shared<const Object>(std::move(members))) {}

    bool isNull() const { return std::holds_alternative<std::monostate>(data_); }
    bool isBool() const { return std::holds_alternative<bool>(data_); }
    bool isNumber() const { return std::holds_alternative<double>(data_); }
    bool isString() const { return std::holds_alternative<std::string>(data_); }
    bool isArray() const { return std::holds_alternative<std::shared_ptr<const Array>>(data_); }
    bool isObject() const { return std::holds_alternative<std::shared_ptr<const Object>>(data_); }

    // Each throws when the value is of another kind; given a fallback, it returns that for null.
    bool asBool() const;
    bool asBool(bool fallback) const;
    double asNumber() const;
    double asNumber(double fallback) const;
    const std::string &asString() const;
    std::string asString(std::string fallback) const;
    const Array &asArray() const;
    const Object &asObject() const;
    // An object's member, or null when it has none or is no object.
    const Value &operator[](std::string_view key) const;
    std::string json() const;

private:
    std::variant<std::monostate, bool, double, std::string, std::shared_ptr<const Array>, std::shared_ptr<const Object>> data_;
};

// A call of the page's, which its function answers once, from any thread: with a result, or with why it failed. A call
// that every copy lets go of unanswered fails.
class Call {
public:
    struct State;
    explicit Call(std::shared_ptr<State> state) : state_(std::move(state)) {}

    const std::string &name() const;
    const Value &options() const;
    // Whether the page made the call; the host makes the rest, as <crossbind/app.h> calls the host's own extensions for
    // the app's native code, which reaches more than the page may.
    bool isFromPage() const;
    void resolve(Value result = {}) const;
    void reject(const std::string &message) const;

private:
    std::shared_ptr<State> state_;
};

// A desktop app's launch: its arguments without the program's own, the folder it was launched in, and what lets a Linux
// window take the front from another app: the launch's Wayland activation token or X11 startup id.
struct Launch {
    std::vector<std::string> args;
    std::string cwd;
    std::string token;
};

#if !defined(__ANDROID__)
// A dialog the page opened with alert(), confirm() or prompt(), which its owner answers once, from any thread, as the
// page waits: accept() is an alert's or a confirm's OK, or the text a prompt gives, and cancel() a confirm's or a
// prompt's Cancel. A dialog that every copy lets go of unanswered is cancelled.
class PageDialog {
public:
    enum class Kind { alert, confirm, prompt };
    struct State;
    explicit PageDialog(std::shared_ptr<State> state) : state_(std::move(state)) {}

    Kind kind() const;
    const std::string &message() const;
    // The text prompt() offers to change; empty for the others.
    const std::string &defaultText() const;
    void accept(const std::string &text = {}) const;
    void cancel() const;

private:
    std::shared_ptr<State> state_;
};

// What the page asks to use, which its owner allows or denies once, from any thread, as the page waits. A request that
// every copy lets go of undecided is denied.
class PagePermission {
public:
    struct State;
    explicit PagePermission(std::shared_ptr<State> state) : state_(std::move(state)) {}

    // What it asks for, together: "camera", "microphone", "location", "clipboard", and the webview's others by their
    // names, as "notifications", "midi" or "fonts".
    const std::vector<std::string> &kinds() const;
    // The origin of the frame that asks, as "crossbind://app".
    const std::string &origin() const;
    // Whether app.permissions lists each of the devices it asks for; false for a kind that is no device.
    bool isListed() const;
    void allow() const;
    void deny() const;

private:
    std::shared_ptr<State> state_;
};

// A file input the page's user clicked, which its owner answers once, from any thread, with the paths of what its user
// picked, or with none when they cancelled. One that every copy lets go of unanswered is cancelled.
class FileInput {
public:
    struct State;
    explicit FileInput(std::shared_ptr<State> state) : state_(std::move(state)) {}

    bool allowsMultiple() const;
    // Whether it takes folders, as one with webkitdirectory does.
    bool allowsFolders() const;
    // The types its accept attribute names, as "image/*" or ".png", where the webview tells them: macOS's tells none.
    const std::vector<std::string> &accept() const;
    void pick(const std::vector<std::string> &paths) const;
    void cancel() const;

private:
    std::shared_ptr<State> state_;
};
#endif

// What an extension adds to the app, as its entry runs on the main thread when the app starts, before the app's module.
// The entry adds what the extension does and starts nothing, as every launch runs every entry, one that another instance
// then takes as well: what the extension starts as the app runs, it starts in onWindow.
class Registry {
public:
    using Function = std::function<void(Call)>;

    Registry() = default;
    // The host's registry of one extension, which knows it by its name.
    Registry(std::string extension, Value options) : extension_(std::move(extension)), options_(std::move(options)) {}

    // A function the page calls by this name. It runs on the module's thread, which it must not hold up: it answers
    // there, or hands the call on, as to inBackground(). What it throws fails the call.
    void function(const std::string &name, Function fn);
    // The extension's options, a JSON value: what crossbind.config.js lists it with, or for a host's own extension the
    // app's options it takes; null without any. A copy, which outlives the registry, as its functions do.
    Value options() const { return options_; }
    // Takes the app's launches, as one extension alone does: fn gets each on the main thread, before the app's module
    // starts. false ends the launch with exit status 0, as when the instance that runs took it; what fn throws ends it
    // with status 1 and says why, in a message box as well when the app's user opened it. Desktop apps alone call fn:
    // iOS and Android keep an app to one instance themselves.
    void onLaunch(std::function<bool(const Launch &)> fn);
    // Runs fn on the main thread as the app's window opens, with appWindow() and appWebView() set, before its page
    // loads: where the extension starts what it does as the app runs. A desktop app opens one window, an iOS app one
    // for each scene that connects; an Android app has none an extension reaches, and never calls fn.
    void onWindow(std::function<void()> fn);
    // Runs fn once as the app quits or fails, on the thread that ends it, before its module stops: never in a launch
    // that onLaunch ends, nor in one whose extensions fail to start. A phone's system may end an app without either.
    void onQuit(std::function<void()> fn);
    // Gets each link of the schemes the extension's app.urlSchemes declares, wherever the system hands it over, on any
    // thread, which fn must not hold up, as the later launches wait for it. The host tells the page of none of them. A
    // link is whatever the system hands the app, so fn takes it as it would any address from outside. An extension that
    // declares schemes calls it, and one that calls it declares them; the host's links gets those of app.urlSchemes.
    void onUrl(std::function<void(const std::string &url)> fn);
#if !defined(__ANDROID__)
    // Take the page's dialogs, what it asks to use and its file inputs, each as the extension of its name alone does:
    // page-dialogs, page-permissions and page-files, the host's own, which an extension of the app's under the name
    // replaces. fn gets each on the main thread. Without one, the webview does as it would: WebKit on Apple's
    // platforms answers a dialog as cancelled and shows no picker, WebKitGTK and WebView2 show their own. No extension
    // takes an iOS or a Windows app's file inputs, whose webview shows its own picker.
    void onPageDialog(std::function<void(PageDialog)> fn);
    void onPagePermission(std::function<void(PagePermission)> fn);
    void onFileInput(std::function<void(FileInput)> fn);
#endif

private:
    std::string extension_;
    Value options_;
};

// Runs work on a thread of its own, which answers the call with what work returns, or with what it throws.
void inBackground(Call call, std::function<Value()> work);

// The app's name, as its window and dialogs show it.
std::string appName();

// The page may reach this file or folder, and what is in a folder, through crossbind/app's shell functions from now
// on, as what its user picked: openPath() where app.openPath lists picked, revealInFolder() and trash().
void allowPath(const std::string &path);
// What allowPath() was given so far, as it was given.
std::vector<std::string> allowedPaths();

#if !defined(__ANDROID__) && !(defined(__APPLE__) && TARGET_OS_IPHONE)
// Hands the app a later launch, which an extension's onLaunch took from another process, from any thread: the app
// brings its window to the front, its page hears of the launch as the event second-instance, and each of its links
// reaches the owner of its scheme. A launch that comes before the module has started waits for it.
void launchedAgain(Launch launch);
#endif

#if !defined(__ANDROID__)
// Runs fn on the app's main thread, where the platform's UI is called.
void onMainThread(std::function<void()> fn);

// The app's window, on the main thread: an NSWindow on macOS, a UIWindow on iOS, a GtkWindow on Linux and an HWND on
// Windows; null before it has one.
void *appWindow();

// The app's webview, on the main thread: a WKWebView on macOS and iOS, an ICoreWebView2Controller on Windows, and on
// Linux a WebKitWebView in a vertical GtkBox, which puts the widgets an extension adds to it with gtk_container_add above
// the page at their own height: the window holds the page to app.window's limits, with their height added. Null before
// the app has one.
void *appWebView();
#endif

#if defined(__ANDROID__)
namespace android {

// Calls a function of the extension's Java, the class its app.android.class names, on the UI thread with the app's
// activity. done gets the answer once, on the thread that gives it: why the call failed, or its result.
void callJava(const std::string &extension, const std::string &function, Value::Object options,
    std::function<void(std::optional<std::string> failure, Value result)> done);

}  // namespace android
#endif

}  // namespace crossbind

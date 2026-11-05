#pragma once

// What every app host shares: the module in Hermes on a thread of its own, the page's messages and its crossbind://
// requests. A platform adds the window, the webview and their channels (platform.h).
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include "access.h"
#include "platform.h"

#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>

namespace crossbind {

// A notification as the platform hands it to the extensions, and how the first of them decided to show it.
struct Notification::State {
    std::string id;
    std::string title;
    std::string body;
    Value payload;
    bool isRemote = false;
    bool isAnswered = false;
    bool isTap = false;
    bool isDismissed = false;
    std::string action;
    std::mutex mutex;
    std::optional<NotificationPresentation> presentation;
};

}  // namespace crossbind

namespace crossbind::app {

namespace jsi = facebook::jsi;
using Clock = std::chrono::steady_clock;

std::string readFile(const std::string &path);
std::string toBase64(const uint8_t *bytes, size_t length);
std::vector<uint8_t> fromBase64(const std::string &text);
// A path from UTF-8, which Windows would read in its ANSI code page otherwise.
std::filesystem::path pathOf(const std::string &text);
// The reply of a call that failed, as the page decodes it, with its error's name.
std::string errorReply(const std::string &message, const std::string &name = "Error");
// Text as UTF-8, with U+FFFD in place of each run of bytes that makes no character, as every webview would read it.
std::string validUtf8(const std::string &text);
// A call of the page's to one of the app's functions: its answer, with how many of its messages went before it, and,
// where the page takes them, its messages, each from any thread; and the page that made it, in its window.
struct PageCall {
    std::function<void(Failure, Value, double sent)> answer;
    std::function<void(Value)> message;
    uint64_t page = 0;
    uint64_t window = 0;
};
// A call of the page's to one of the app's functions through crossbind/app, for runCall() to hand its function; null for
// options of no Value, which the call's answer then refuses.
std::shared_ptr<StateOf<Call>> pageCall(jsi::Runtime &rt, const std::string &name, const jsi::Value &options, PageCall page);
void runCall(std::shared_ptr<StateOf<Call>> state);
// Ends a call that waits for its answer, as its page cancelled it or went away: the call's onCancel runs, on the caller's
// thread, and the call answers nothing more. false for one that has answered.
bool cancelCall(const std::shared_ptr<StateOf<Call>> &state);
// A call of the app's own code to one of the app's functions, on the caller's thread, as <crossbind/app.h> makes them:
// done gets why it failed, or its result.
void invoke(const std::string &name, Value options, std::function<void(Failure, Value)> done);
// Adds the host's own functions, the ones crossbind/app calls.
void appFunctions(Registry &registry);
// Adds crossbind/app's windows.* among them.
void windowFunctions(Registry &registry);
// Runs the entry of each of the app's extensions with native code through startExtension(), from the file crossbind
// writes of them into the host's build.
void extensionEntries();
// Runs one extension's entry with a registry of its own, which knows it by its name and holds its options, read from
// their JSON or null, with the roles of the host's it holds and, for one of the host's own, those an app's extension
// took; what the entry throws, it throws, naming the extension.
void startExtension(const char *name, const char *options, void (*entry)(Registry &), std::vector<std::string> roles,
    std::vector<std::string> given);
// The app's URL schemes, from the same file, each with the extension whose onOpenUrl gets its links: the one that
// declared it, or for those of app.urlSchemes the holder of links, which the host's hands to the page.
std::vector<std::pair<std::string, std::string>> urlSchemes();
// The extensions of the files the app opens, each with the extension whose onOpenFiles gets them, the host's files for
// those of app.fileTypes; the MIME types one owner's types alone list, each with that owner, which an Android file's
// names before its name does; and the https links of app.links, a domain and maybe the path they start with, each with
// the extension whose onOpenUrl gets them, the holder of links for the app's own.
std::vector<std::pair<std::string, std::string>> fileTypes();
std::vector<std::pair<std::string, std::string>> fileMimeTypes();
std::vector<std::pair<std::string, std::string>> appLinks();
// The types of the user activities the app continues, each with the extension whose onUserActivity gets them, the
// host's activities for those of app.activityTypes.
std::vector<std::pair<std::string, std::string>> userActivityTypes();
// The types of the quick actions of the app's icon, each with the extension whose onShortcutItem gets their taps, the
// host's shortcuts for those of app.shortcutItems.
std::vector<std::pair<std::string, std::string>> shortcutItemTypes();
// Adds the host's refusals of what crossbind/app reaches that no extension of the app added: the activities' function,
// which an Apple app with app.activityTypes alone has, and the updater's functions, which a desktop app with app.updater
// alone has.
void refusedFunctions(Registry &registry);
// Adds the host's functions and runs the extensions' entries, once, on the main thread as the app starts, before its
// module does; an entry that throws, or extensions that break a rule of what they add, throw.
void startExtensions();
// Whether the app runs on with a desktop app's launch, as the extension that takes its launches decides: true without
// one, and without a launch, as a phone's. What the extension throws, it throws.
bool launched(const Launch *launch);
// Runs the extensions' onStart, on the main thread, once the app runs on with its launch: what one throws, it throws,
// naming the extension.
void started();
// The launch the app started with, as start() was given it before its extensions start, its links among its arguments;
// none on a phone.
Launch &firstLaunch();
// Runs the extensions' onWindow, on the main thread, as a window of the app's has opened, before its page loads, with
// the name crossbind/app's windows.open() gave it, if any: the window's id. The window comes to the front, and the pages
// hear of it as the event window-opened.
uint64_t windowOpened(void *window, void *webView, std::string name = "");
// Runs the extensions' onWindowClosed, on the main thread, as the window of this id closes, whose page goes with it, and
// the pages hear of it as the event window-closed.
void windowClosed(uint64_t id);
// The running module lets go of what the page of the window of this id held, as the window closed; from any thread.
void closeChannel(uint64_t window);
// The window of this id came to the front, as its user used it, on the main thread.
void windowFocused(uint64_t id);
// The name windows.open() gave the open window of this id, or "" for none; from any thread.
std::string nameOfWindow(uint64_t id);
// The open window in front, of the window its user used last, or 0 for none; from any thread.
uint64_t frontWindow();
// The open windows, the one in front first, then as their user used them last; from any thread.
std::vector<uint64_t> frontWindows();
// Runs the extensions' onPage, on the module's thread, as a page of the app's starts.
void pageStarted(const Page &page);
// Runs the extensions' onQuit, once, in an app that runs on with its launch.
void quitting();
// Hands a link to the onOpenUrl of the extension that owns its scheme.
void openUrlOf(const std::string &extension, const std::string &url);
// Hands files to the onOpenFiles of the extension that owns their type.
void openFilesOf(const std::string &extension, const OpenFiles &files);
// Hands a user activity to the onUserActivity of the extension that owns its type: whether it took it.
bool continueActivityOf(const std::string &extension, const UserActivity &activity);
// Hands the tap of a quick action to the onShortcutItem of the extension that owns its type: whether it took it.
bool tapShortcutItemOf(const std::string &extension, const std::string &type);
// Runs each extension's onNotification with this notification: how to show one while the app is in front, as the first
// hook decided, or as a banner, in the list and with its sound.
NotificationPresentation notified(std::shared_ptr<StateOf<Notification>> state);
// Runs each extension's onPushToken with the app's push token, as hex, or its onPushTokenFailure with why the system
// gave none.
void pushTokenArrived(const std::string &hex);
void pushTokenFailed(const std::string &message);
// What a silent push's handlers answered, as one.
enum class PushResult { noData, newData, failed };
// Runs each extension's onPushMessage with a silent push's payload: done gets their answers as one, once, on any thread,
// as the last answers or 25 s after the push came; without done, as on macOS, which takes no answer, nothing waits.
void pushArrived(const Value &payload, std::function<void(PushResult)> done);
// Whether the app has a function of this name so far.
bool hasFunction(const std::string &name);
// The route of the extension of this name, which the extensions' entries added, or null without one.
const std::function<void(Request)> *routeOf(const std::string &extension);
// A request for one of an extension's URLs, its path decoded, as /ext/<extension>/<path>; respond() may be called from any
// thread.
void serveRoute(SchemeRequest request, SchemeRespond respond);
// The type of a file the host serves, by its extension.
std::string mimeTypeOf(const std::filesystem::path &file);
// The value of JSON text; text that is no JSON throws.
Value valueOfJson(std::string_view text);
// JSON text whose bytes stand in it as tags of their places among bytes, as an Android extension's Java takes and gives
// them, and the value of such text with its bytes in their places.
std::string jsonWithBytes(const Value &value, std::vector<Value::Bytes> &bytes);
Value valueWithBytes(std::string_view text, const std::vector<Value::Bytes> &bytes);
// Whether the main thread answers the waits of <crossbind/app.h>: from the module's start until the app quits.
void answerWaits(bool answer);
// The pages an event reaches: every one that listens to its name, the one page given, or the page in front that
// listens, of the window its user used last.
enum class Reach { everyPage, onePage, frontPage };
// Sends an event of the app's native code to the pages, from any thread, through the app's one module, which gets those
// sent before it booted as it boots. A held one waits for a page to ask for the events of its name, and reaches the
// page in front that asked, whatever reach says.
void postEvent(std::string event, std::string json, bool isHeld = false, Reach reach = Reach::everyPage, uint64_t page = 0);

// Runs every JS task on one thread, as JSI requires, and drains Hermes' microtasks after each, so a reply that waits
// on a promise goes out before the next message.
class JsThread {
public:
    using Task = std::function<void(jsi::Runtime &)>;

    void start(Task boot);
    void post(Task task);
    // On the JS thread itself the task runs at once, in its place among what the module's call there does, and drains
    // no microtask in the middle of that call; from another thread it is posted.
    void postOrRun(Task task);
    void postAfter(double ms, Task task);
    // The runtime stays alive: bindings keep JSI values in globals that would outlive its teardown.
    void stop();

private:
    Task next();
    void loop(const Task &boot);
    void run(const Task &task, bool drains = true);

    std::unique_ptr<facebook::hermes::HermesRuntime> runtime_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<Task> tasks_;
    std::multimap<Clock::time_point, Task> timers_;
    bool stopping_ = false;
    std::thread thread_;
};

class Core {
public:
    explicit Core(std::string pageDir) : pageDir_(std::move(pageDir)) {}

    // Loads the host bundle, Hermes bytecode or source, and starts the module. Returns an error, or nothing.
    std::string boot(std::string bundle, const std::string &sourceUrl, const std::string &dataPath);
    // The token of the channel of a window's pages, 0 for an Android page's, for its top frame alone: every message and
    // every call made as a crossbind:// request carries it, which names the window, so markup and frames that cannot read
    // the top frame's globals cannot make one. From any thread, before the window's page loads.
    std::string addWindow(uint64_t window);
    // A page message, which the host bundle answers through __host_reply.
    void receive(std::string message, ReplyFn reply);
    // The page's files, and the calls whose bytes are the request or response body.
    void serve(SchemeRequest request, SchemeRespond respond);
    // A new page replaced the one that held the module's objects in the window of this id, as the webview committed it.
    void reset(uint64_t window);
    // The window of this id closed: its page's calls are cancelled, and what it held let go of.
    void closed(uint64_t window);
    // An event for the pages, from any thread.
    void postEvent(std::string event, std::string json, bool isHeld, Reach reach, uint64_t page);
    void stop() {
        // A wait of the module's code would hold the join below forever.
        answerWaits(false);
        js_.stop();
    }

    // The dev server's origin, which every response lets read it, as its page needs; empty for none, as a page of
    // another origin that page-navigation loads reads nothing of the app's.
    std::string corsOrigin;

private:
    struct PageFunction;
    // A call of the page's that waits for its answer, and the reply it answers.
    struct OpenCall {
        std::weak_ptr<StateOf<Call>> state;
        std::string reply;
        std::string name;
    };
    // A window's channel, on the JS thread: the page it shows; the functions that page passed, by its id for each, while
    // the module holds them, whose weak references belong to the JS thread and the runtime, which a Core outlives, as
    // nothing deletes one; its calls that wait for their answers, by the page's id of each, which a new page cancels;
    // and the ids of those it cancelled before they came, as a call that carries bytes takes another channel than its
    // cancel. A new page counts anew, and what the one before passed reaches no page.
    struct Channel {
        long long page = 0;
        std::unordered_map<long long, std::pair<std::weak_ptr<PageFunction>, jsi::WeakObject>> pageFunctions;
        std::unordered_map<long long, OpenCall> openCalls;
        std::unordered_set<long long> cancelledEarly;
    };
    // What the host bundle's reply of a message answers, and the window whose page sent it.
    struct Reply {
        ReplyFn answer;
        uint64_t window;
    };

    void installHostFunctions(jsi::Runtime &rt);
    // Hands the reply of this call of the page's its text, once; on the JS thread.
    void reply(const std::string &call, const std::string &text);
    // The window whose token this is, on the JS thread; none for a token of no open window's.
    std::optional<uint64_t> windowOfToken(const std::string &token) const;
    // The window that shows the page of this id, on the JS thread; none once it went.
    std::optional<uint64_t> windowOfPage(long long page) const;
    // A call of the page's to one of the app's functions, which call names the reply of, and id the page's own.
    void callApp(jsi::Runtime &rt, std::string call, const std::string &name, const jsi::Value &options, long long id, bool wantsMessages);
    // The page whose message call names the reply of cancelled its call of this id, which it sent in a frame or as a
    // message.
    void cancelCall(const std::string &call, long long id, bool isFramed);
    // Cancels each call of a channel's page that waits for its answer.
    void cancelOpenCalls(Channel &channel);
    // The frame of a call of the window's page, whose reply answers the request; on the JS thread.
    void serveFrame(jsi::Runtime &rt, uint64_t window, SchemeRequest request, SchemeRespond respond);
    // The module's function for one the page passed: the same one while the module holds it.
    jsi::Value pageFunction(jsi::Runtime &rt, long long page, long long id);
    void dropped(long long page, long long id, double passed);

    JsThread js_;
    // The windows' channels, by their ids, and their tokens, on the JS thread.
    std::unordered_map<uint64_t, Channel> channels_;
    std::unordered_map<std::string, uint64_t> tokens_;
    std::string pageDir_;
    std::unordered_map<std::string, Reply> replies_;
    long long nextReply_ = 0;
};

}  // namespace crossbind::app

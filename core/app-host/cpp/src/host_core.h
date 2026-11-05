#pragma once

// What every app host shares: the module in Hermes on a thread of its own, the page's messages and its crossbind://
// requests. A platform adds the window, the webview and their channels (platform.h).
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include "crossbind/extension.h"
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

namespace crossbind::app {

namespace jsi = facebook::jsi;
using Clock = std::chrono::steady_clock;

std::string readFile(const std::string &path);
std::string toBase64(const uint8_t *bytes, size_t length);
std::vector<uint8_t> fromBase64(const std::string &text);
// A path from UTF-8, which Windows would read in its ANSI code page otherwise.
std::filesystem::path pathOf(const std::string &text);
// The reply of a call that failed, as the page decodes it.
std::string errorReply(const std::string &message);
// A call of the page to one of the app's functions through crossbind/app, which reply answers once it is done.
void callApp(jsi::Runtime &rt, const std::string &name, const jsi::Value &options, ReplyFn reply);
// A call of the app's own code to one of the app's functions, on the caller's thread, as <crossbind/app.h> makes them:
// done gets why it failed, or its result.
void invoke(const std::string &name, Value options, std::function<void(Failure, Value)> done);
// Adds the host's own functions, the ones crossbind/app calls.
void appFunctions(Registry &registry);
// Adds the functions of the app's extensions, through the file crossbind writes of them into the host's build.
void extensionFunctions(Registry &registry);
// The value of JSON text; text that is no JSON throws.
Value valueOfJson(std::string_view text);
// Whether the main thread answers the waits of <crossbind/app.h>: from the module's start until the app quits.
void answerWaits(bool answer);
// Sends an event of the app's native code to the page, from any thread, through the app's one module; before it boots,
// nowhere.
void postEvent(std::string event, std::string json);

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
    // A page message, which the host bundle answers through __host_reply.
    void receive(std::string message, ReplyFn reply);
    // The page's files, and the calls whose bytes are the request or response body.
    void serve(SchemeRequest request, SchemeRespond respond);
    // A new page replaced the one that held the module's objects.
    void reset();
    // An event for the page, from any thread.
    void postEvent(std::string event, std::string json);
    void stop() {
        // A wait of the module's code would hold the join below forever.
        answerWaits(false);
        js_.stop();
    }
    const std::string &token() const { return token_; }

    // Every response lets any origin read it, as a page from a dev server needs.
    bool cors = false;

private:
    struct PageFunction;

    void installHostFunctions(jsi::Runtime &rt);
    // The module's function for one the page passed: the same one while the module holds it.
    jsi::Value pageFunction(jsi::Runtime &rt, long long id);
    void dropped(long long page, long long id, double passed);

    JsThread js_;
    // The functions the page passed, by its id for each, while the module holds them. A new page counts anew, and the
    // functions of the one before reach no page. Their weak references belong to the JS thread and the runtime, which
    // a Core outlives, as nothing deletes one.
    long long page_ = 0;
    std::unordered_map<long long, std::pair<std::weak_ptr<PageFunction>, jsi::WeakObject>> pageFunctions_;
    std::string pageDir_;
    // Made at boot for the page's top frame. Every message and every call made as a crossbind:// request carries it, so
    // markup and frames that cannot read the top frame's globals cannot make one.
    std::string token_;
    std::unordered_map<std::string, ReplyFn> replies_;
    long long nextReply_ = 0;
};

}  // namespace crossbind::app

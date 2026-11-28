// The fixture's hooks: e2e/run.mjs's steps and their reports through its endpoint, for a page of the app's and of a
// project's alike, which the run tells apart by the page's role; the preview's end, which the app's own code asks of the
// preview extension; whether an origin is served now, which serveOrigin() refuses a name of; the preview's question of a
// project's devices, asked as an extension asks it and read and answered as its user would; and the preview's
// indicator and its menu, read and pressed as its user sees them, and noted at the endpoint as each page starts.
#include "crossbind/extension.h"

#include <chrono>
#include <condition_variable>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using crossbind::Call;
using crossbind::Value;

const std::vector<std::string> PAGES{"app", "project"};

// Where the main thread may be held while a session is checked: Linux's fetch runs on the main thread's loop, and
// Android's HMAC is the preview extension's Java's, on the UI thread.
#if defined(__APPLE__) || defined(_WIN32)
constexpr bool CAN_HOLD = true;
#else
constexpr bool CAN_HOLD = false;
#endif
// How long the second open is given to be served before the main thread goes on.
constexpr auto SERVED_IN = std::chrono::milliseconds(500);

// What a function the app's own code calls answered: why it failed, or its value.
struct Answer {
    std::optional<std::string> failure;
    Value value;
};

std::future<Answer> invoked(const std::string &name, Value options) {
    auto answer = std::make_shared<std::promise<Answer>>();
    std::future<Answer> answered = answer->get_future();
    crossbind::invoke(name, std::move(options), [answer](std::optional<std::string> failure, Value value) { answer->set_value({std::move(failure), std::move(value)}); });
    return answered;
}

Value outcomeOf(const Answer &answer) {
    return answer.failure ? Value(Value::Object{{"error", *answer.failure}}) : Value(Value::Object{{"value", answer.value}});
}

// How long a call took since, and why it failed where it did.
Value timedOutcomeOf(const Answer &answer, std::chrono::steady_clock::time_point since) {
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - since).count();
    Value::Object timed{{"ms", static_cast<double>(ms)}};
    if (answer.failure) timed.emplace_back("error", *answer.failure);
    return timed;
}

// The main thread held from once it is until released, ten seconds at most; Android's UI thread is the Java's.
class MainHold {
public:
    void hold() {
#if !defined(__ANDROID__)
        auto isHeld = std::make_shared<std::promise<void>>();
        std::future<void> held = isHeld->get_future();
        crossbind::onMainThread([state = state_, isHeld] {
            const auto heldAtMost = std::chrono::seconds(10);
            isHeld->set_value();
            std::unique_lock<std::mutex> lock(state->mutex);
            state->released.wait_for(lock, heldAtMost, [&] { return state->isReleased; });
        });
        held.wait();
#endif
    }

    void release() {
        {
            std::lock_guard<std::mutex> lock(state_->mutex);
            state_->isReleased = true;
        }
        state_->released.notify_all();
    }

private:
    struct State {
        std::mutex mutex;
        std::condition_variable released;
        bool isReleased = false;
    };
    std::shared_ptr<State> state_ = std::make_shared<State>();
};

// Two sessions checked and opened by the app's own code, the second's open on its way while the first one's indicator
// waits for the main thread, which is held from before the first open until the second is served where the second's
// check needs none of it: whether it was held, what each open answered, and the URL the page goes to, the second's.
void openTwo(Call call) {
    const Value first = Value::Object{{"session", call.options()["first"]}};
    const Value second = Value::Object{{"session", call.options()["second"]}};
    std::thread([call, first, second] {
        const Answer firstChecked = invoked("preview.check", first).get();
        if (firstChecked.failure) return call.reject("the first session's check: " + *firstChecked.failure);
        MainHold hold;
        if (CAN_HOLD) hold.hold();
        std::future<Answer> firstOpened = invoked("preview.open", first);
        const Answer secondChecked = invoked("preview.check", second).get();
        std::optional<std::future<Answer>> secondOpened;
        if (!secondChecked.failure) secondOpened = invoked("preview.open", second);
        std::this_thread::sleep_for(SERVED_IN);
        hold.release();
        const Answer firstAnswer = firstOpened.get();
        const Answer secondAnswer = secondOpened ? secondOpened->get() : secondChecked;
        call.resolve(Value::Object{{"held", CAN_HOLD}, {"first", outcomeOf(firstAnswer)}, {"second", outcomeOf(secondAnswer)},
            {"url", secondAnswer.failure ? Value() : secondAnswer.value["url"]}});
    }).detach();
}

}  // namespace

#if defined(__APPLE__) && TARGET_OS_IPHONE
void handLinkAsIos(crossbind::Call call);
#endif
#if defined(__APPLE__) || (defined(__linux__) && !defined(__ANDROID__))
// The question up now, as its user reads it, and a press of its button: the platform's file.
void questionUp(crossbind::Call call);
void pressInQuestion(crossbind::Call call);
#endif
#if defined(__APPLE__) && !TARGET_OS_IPHONE
void cancelInQuestion(crossbind::Call call);
void endSheet(crossbind::Call call);
void fillScreen(crossbind::Call call);
void cycleActive(crossbind::Call call);
#endif
#if defined(__APPLE__)
// A control of the preview's Permissions held while the preview ends, then pressed.
void pressAfterEnd(crossbind::Call call);
#endif
#if !defined(__ANDROID__)
// The preview's indicator as its user sees it now, on the main thread, and an item of its menu pressed: the platform's
// file.
crossbind::Value indicatorState();
void indicatorUp(crossbind::Call call);
void pressIndicator(crossbind::Call call);
#endif
#if defined(_WIN32)
// Each request for a served origin's first page that WebView2 hands the host in the window, noted at the endpoint.
void noteFirstPages(const std::string &endpoint, const crossbind::Window &window);
#endif
#if defined(__APPLE__)
// A script run in the page as its user's click would run it; the indicator and the app's alerts noted later; and a file
// input's picker read and closed.
void gesture(crossbind::Call call);
void noteLater(const std::string &endpoint, crossbind::Call call);
void pickerUp(crossbind::Call call);
void dismissPicker(crossbind::Call call);
#endif

namespace {

// The indicator as each page starts, which the run reads its order by.
void noteIndicator(std::function<void(crossbind::Value indicator)> noted) {
#if defined(__ANDROID__)
    crossbind::android::callJava("e2e-hooks", "indicator", crossbind::Value::Object{}, [noted](std::optional<std::string> failure, crossbind::Value state) {
        noted(failure ? crossbind::Value(crossbind::Value::Object{{"failure", *failure}}) : state);
    });
#else
    crossbind::onMainThread([noted] { noted(indicatorState()); });
#endif
}

// The page's role at the run's endpoint: a desktop's second window's as app2 and project2.
std::string roleAt(const crossbind::Page &page) { return page.role() + (page.windowId() >= 2 ? std::to_string(page.windowId()) : ""); }

}  // namespace

void crossbind_extension_e2e_hooks(crossbind::Registry &registry) {
    const std::string endpoint = registry.options()["endpoint"].asString();
    // A path of the endpoint's with the page's role, and a body that is POSTed.
    registry.function("e2e-hooks.ask", PAGES, [endpoint](Call call) {
        const std::string path = call.options()["path"].asString();
        const Value &body = call.options()["body"];
        const std::string url = endpoint + path + (path.find('?') == std::string::npos ? "?" : "&") + "role=" + roleAt(call.page());
        crossbind::fetch(body.isNull() ? "GET" : "POST", url, {{"Content-Type", "application/json"}}, body.isNull() ? "" : body.asString(),
            [call](std::optional<std::string> failure, crossbind::FetchResponse response) {
                if (failure) call.reject(*failure);
                else call.resolve(Value::Object{{"status", response.status}, {"text", response.body}});
            });
    });
    // Each page as it starts, with the indicator as it is then, at the endpoint, which no page has to report.
    registry.onPage([endpoint](const crossbind::Page &page) {
        const Value started = Value::Object{{"event", "page"}, {"page", static_cast<double>(page.id())}, {"window", static_cast<double>(page.windowId())},
            {"role", page.role()}, {"label", page.label()}};
        noteIndicator([endpoint, started](Value indicator) {
            const std::string body = Value(Value::Object{{"event", started["event"]}, {"page", started["page"]}, {"window", started["window"]}, {"role", started["role"]},
                {"label", started["label"]}, {"indicator", indicator}}).json();
            crossbind::fetch("POST", endpoint + "/report?role=app", {{"Content-Type", "application/json"}}, body, [](std::optional<std::string>, crossbind::FetchResponse) {});
        });
    });
#if defined(_WIN32)
    registry.onWindow([endpoint](const crossbind::Window &window) { noteFirstPages(endpoint, window); });
#endif
#if defined(__ANDROID__)
    registry.function("e2e-hooks.indicator", PAGES, [](Call call) { crossbind::android::callJava("e2e-hooks", "indicator", call); });
#else
    registry.function("e2e-hooks.indicator", PAGES, indicatorUp);
    registry.function("e2e-hooks.pressIndicator", PAGES, pressIndicator);
#endif
#if defined(__APPLE__)
    registry.function("e2e-hooks.pressAfterEnd", PAGES, pressAfterEnd);
    registry.function("e2e-hooks.gesture", PAGES, gesture);
    registry.function("e2e-hooks.noteLater", PAGES, [endpoint](Call call) { noteLater(endpoint, call); });
    registry.function("e2e-hooks.pickerUp", PAGES, pickerUp);
    registry.function("e2e-hooks.dismissPicker", PAGES, dismissPicker);
#endif
#if defined(__APPLE__) && !TARGET_OS_IPHONE
    registry.function("e2e-hooks.fillScreen", PAGES, fillScreen);
    registry.function("e2e-hooks.cycleActive", PAGES, cycleActive);
#endif
    // A session checked and opened by the app's own code, as no page asks it, whatever its window shows meanwhile. What
    // the check and the open answered and how long each took are noted at the endpoint once it ended, with when the check
    // began by the system's clock, which the run places the stand-in cloud's and the source's requests by.
    registry.function("e2e-hooks.openPreview", PAGES, [endpoint](Call call) {
        const Value session = Value::Object{{"session", call.options()["session"]}};
        const auto ms = std::chrono::milliseconds(static_cast<long>(call.options()["ms"].asNumber(0)));
        call.resolve();
        std::thread([endpoint, session, ms] {
            std::this_thread::sleep_for(ms);
            const auto at = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            const auto checking = std::chrono::steady_clock::now();
            const Answer checked = invoked("preview.check", session).get();
            Value opened;
            if (!checked.failure) {
                const auto opening = std::chrono::steady_clock::now();
                opened = timedOutcomeOf(invoked("preview.open", session).get(), opening);
            }
            const std::string noted = Value(Value::Object{{"event", "opened"}, {"session", session["session"]}, {"at", static_cast<double>(at)},
                {"check", timedOutcomeOf(checked, checking)}, {"open", opened}}).json();
            crossbind::fetch("POST", endpoint + "/report?role=app", {{"Content-Type", "application/json"}}, noted, [](std::optional<std::string>, crossbind::FetchResponse) {});
        }).detach();
    });
    // A step's presses, of the preview's menu, of a question's button or a script run as its user's click, and a session
    // the app's own code opens, each once its ms passed, armed only once the run has the step's report, which the hook
    // makes for the page: a press that ends the page cannot come before it, however slow the calls.
    registry.function("e2e-hooks.presses", PAGES, [endpoint](Call call) {
        const Value step = call.options();
        const std::string report = Value(Value::Object{{"id", step["id"]}, {"value", "armed"}}).json();
        crossbind::fetch("POST", endpoint + "/report?role=" + roleAt(call.page()), {{"Content-Type", "application/json"}}, report,
            [call, step, endpoint](std::optional<std::string> failure, crossbind::FetchResponse) {
                if (failure) {
                    call.reject(*failure);
                    return;
                }
                for (const Value &press : step["presses"].asArray()) {
                    // A script's outcome is noted at the endpoint: it fails where its page went before it ran.
                    if (!press["gesture"].isNull()) {
                        const auto ms = std::chrono::milliseconds(static_cast<long>(press["ms"].asNumber(0)));
                        std::thread([script = press["gesture"], ms, endpoint] {
                            std::this_thread::sleep_for(ms);
                            crossbind::invoke("e2e-hooks.gesture", Value::Object{{"script", script}}, [endpoint](std::optional<std::string> failure, Value) {
                                const std::string noted = Value(Value::Object{{"event", "gesture"}, {"failure", failure ? Value(*failure) : Value()}}).json();
                                crossbind::fetch("POST", endpoint + "/report?role=app", {{"Content-Type", "application/json"}}, noted, [](std::optional<std::string>, crossbind::FetchResponse) {});
                            });
                        }).detach();
                        continue;
                    }
                    const char *pressing = !press["afterEnd"].isNull() ? "e2e-hooks.pressAfterEnd" : press["item"].isNull() ? "e2e-hooks.press" : "e2e-hooks.pressIndicator";
                    crossbind::invoke(pressing, press, [](std::optional<std::string>, Value) {});
                }
                if (!step["open"].isNull()) {
                    crossbind::invoke("e2e-hooks.openPreview", Value::Object{{"session", step["open"]}, {"ms", step["openMs"]}}, [](std::optional<std::string>, Value) {});
                }
                call.resolve();
            });
    });
    registry.function("e2e-hooks.openTwo", PAGES, openTwo);
    registry.function("e2e-hooks.closePreview", PAGES, [](Call call) {
        crossbind::invoke("preview.close", Value::Object{}, [call](std::optional<std::string> failure, Value) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
    // A session checked and opened by the app's own code, and what the open answered: its URL, or why it was refused.
    registry.function("e2e-hooks.tryOpen", PAGES, [](Call call) {
        const Value session = Value::Object{{"session", call.options()["session"]}};
        crossbind::invoke("preview.check", session, [call, session](std::optional<std::string> failure, Value) {
            if (failure) return call.resolve(Value::Object{{"checked", *failure}});
            crossbind::invoke("preview.open", session, [call](std::optional<std::string> refused, Value opened) {
                call.resolve(refused ? Value(Value::Object{{"refused", *refused}}) : Value(Value::Object{{"url", opened["url"]}}));
            });
        });
    });
    // The app signed out by its own code, as a sign-out ends the preview open.
    registry.function("e2e-hooks.signOut", PAGES, [](Call call) {
        crossbind::invoke("preview.signOut", Value::Object{}, [call](std::optional<std::string> failure, Value) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
    // The event note, to every page of the role app or to the calling page alone, whatever its role.
    const crossbind::Events events = registry.events();
    registry.function("e2e-hooks.emit", PAGES, [events](Call call) {
        const Value &value = call.options()["value"];
        if (call.options()["to"].asString() == "own") events.emit("note", value, call.page());
        else events.emit("note", value);
        call.resolve();
    });
    // A path the app's page may reach from now on through the shell's functions, as one its user picked.
    registry.function("e2e-hooks.allow", [](Call call) {
        crossbind::allowPath(call.options()["path"].asString());
        call.resolve();
    });
    registry.function("e2e-hooks.served", PAGES, [](Call call) {
        const std::string name = call.options()["name"].asString();
        try {
            crossbind::serveOrigin(name, "e2e", [](crossbind::Request request) { request.respond(404); }).end();
            call.resolve(false);
        } catch (const std::invalid_argument &error) {
            call.reject(error.what());
        } catch (const std::logic_error &) {
            call.resolve(true);
        }
    });
#if defined(__APPLE__) && TARGET_OS_IPHONE
    registry.function("e2e-hooks.handLink", handLinkAsIos);
#endif
#if !defined(__ANDROID__)
    // What a page of the origin given asks to use, asked of page-permissions as an extension asks it, where a web view
    // asks no holder: it grants nothing and skips nothing, and the question's own button answers it.
    registry.function("e2e-hooks.askPermission", PAGES, [](Call call) {
        std::vector<std::string> kinds;
        for (const Value &kind : call.options()["kinds"].asArray()) kinds.push_back(kind.asString());
        crossbind::askPagePermission(kinds, call.options()["origin"].asString(), [call](bool isAllowed) { call.resolve(Value::Object{{"allowed", isAllowed}}); });
    });
#endif
#if defined(__APPLE__) || (defined(__linux__) && !defined(__ANDROID__))
    registry.function("e2e-hooks.question", PAGES, questionUp);
    registry.function("e2e-hooks.press", PAGES, pressInQuestion);
#endif
#if defined(__APPLE__) && !TARGET_OS_IPHONE
    registry.function("e2e-hooks.cancel", PAGES, cancelInQuestion);
    registry.function("e2e-hooks.endSheet", PAGES, endSheet);
#endif
#if defined(__ANDROID__)
    registry.function("e2e-hooks.breakKey", [](Call call) {
        crossbind::android::callJava("e2e-hooks", "breakKey", Value::Object{}, [call](std::optional<std::string> failure, Value) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
#endif
}

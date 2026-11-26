// The fixture's hooks: e2e/run.mjs's steps and their reports through its endpoint, for a page of the app's and of a
// project's alike, which the run tells apart by the page's role; the preview's end, which the app's own code asks of the
// preview extension; whether an origin is served now, which serveOrigin() refuses a name of; the preview's question of a
// project's devices, asked as an extension asks it and read and answered as its user would; and the preview's
// indicator and its menu, read and pressed as its user sees them, and noted at the endpoint as each page starts.
#include "crossbind/extension.h"

#include <chrono>
#include <functional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using crossbind::Call;
using crossbind::Value;

const std::vector<std::string> PAGES{"app", "project"};

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
void fillScreen(crossbind::Call call);
void cycleActive(crossbind::Call call);
#endif
#if !defined(__ANDROID__)
// The preview's indicator as its user sees it now, on the main thread, and an item of its menu pressed: the platform's
// file.
crossbind::Value indicatorState();
void indicatorUp(crossbind::Call call);
void pressIndicator(crossbind::Call call);
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

}  // namespace

void crossbind_extension_e2e_hooks(crossbind::Registry &registry) {
    const std::string endpoint = registry.options()["endpoint"].asString();
    // A path of the endpoint's with the page's role, and a body that is POSTed.
    registry.function("e2e-hooks.ask", PAGES, [endpoint](Call call) {
        const std::string path = call.options()["path"].asString();
        const Value &body = call.options()["body"];
        const std::string url = endpoint + path + (path.find('?') == std::string::npos ? "?" : "&") + "role=" + call.page().role();
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
#if defined(__ANDROID__)
    registry.function("e2e-hooks.indicator", PAGES, [](Call call) { crossbind::android::callJava("e2e-hooks", "indicator", call); });
#else
    registry.function("e2e-hooks.indicator", PAGES, indicatorUp);
    registry.function("e2e-hooks.pressIndicator", PAGES, pressIndicator);
#endif
#if defined(__APPLE__)
    registry.function("e2e-hooks.gesture", PAGES, gesture);
    registry.function("e2e-hooks.noteLater", PAGES, [endpoint](Call call) { noteLater(endpoint, call); });
    registry.function("e2e-hooks.pickerUp", PAGES, pickerUp);
    registry.function("e2e-hooks.dismissPicker", PAGES, dismissPicker);
#endif
#if defined(__APPLE__) && !TARGET_OS_IPHONE
    registry.function("e2e-hooks.fillScreen", PAGES, fillScreen);
    registry.function("e2e-hooks.cycleActive", PAGES, cycleActive);
#endif
    // A session checked and opened by the app's own code, as no page asks it, whatever its window shows meanwhile.
    registry.function("e2e-hooks.openPreview", PAGES, [](Call call) {
        const Value session = Value::Object{{"session", call.options()["session"]}};
        const auto ms = std::chrono::milliseconds(static_cast<long>(call.options()["ms"].asNumber(0)));
        call.resolve();
        std::thread([session, ms] {
            std::this_thread::sleep_for(ms);
            crossbind::invoke("preview.check", session, [session](std::optional<std::string> failure, Value) {
                if (!failure) crossbind::invoke("preview.open", session, [](std::optional<std::string>, Value) {});
            });
        }).detach();
    });
    registry.function("e2e-hooks.closePreview", PAGES, [](Call call) {
        crossbind::invoke("preview.close", Value::Object{}, [call](std::optional<std::string> failure, Value) {
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

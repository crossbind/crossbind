// The fixture's hooks: e2e/run.mjs's steps and their reports through its endpoint, for a page of the app's and of a
// project's alike, which the run tells apart by the page's role; the preview's end, which the app's own code asks of the
// preview extension; and whether an origin is served now, which serveOrigin() refuses a name of.
#include "crossbind/extension.h"

#include <stdexcept>
#include <string>
#include <vector>

namespace {

using crossbind::Call;
using crossbind::Value;

const std::vector<std::string> PAGES{"app", "project"};

}  // namespace

#if defined(__APPLE__) && TARGET_OS_IPHONE
void handLinkAsIos(crossbind::Call call);
#endif

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
#if defined(__ANDROID__)
    registry.function("e2e-hooks.breakKey", [](Call call) {
        crossbind::android::callJava("e2e-hooks", "breakKey", Value::Object{}, [call](std::optional<std::string> failure, Value) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
#endif
}

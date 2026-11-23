// The probe's origins, which the conformance page opens as a project's page would be opened: each of the role project,
// whose handler is a proxy, as a preview's would be, of e2e/run.mjs's endpoint, which serves the built page as a dev
// server would. And what the page checks them with: the host's fetch(), the roles of its calls, and what the pages
// leave for the conformance page across their loads.
#include "probe.h"

#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace {

using crossbind::Call;
using crossbind::Value;

// The endpoint's page, as every run's app reaches it: the device's own loopback, which adb reverse forwards on Android.
constexpr const char *SOURCE = "http://127.0.0.1:47831/page";
// Where nothing listens, as a dev server that stopped, which the page asks for under /down/.
constexpr const char *DOWN_SOURCE = "http://127.0.0.1:47832";
// What the proxy passes of an answer beside its status; Set-Cookie and every other header go.
const std::set<std::string> PASSED{"content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"};
const std::vector<std::string> PAGES{"app", "project"};
const crossbind::Request::Headers TEXT{{"Content-Type", "text/plain; charset=utf-8"}};
// A body whose bytes the endpoint makes as i % 251, which probe.fetch checks.
constexpr unsigned PATTERN = 251;

std::mutex originsMutex;
std::map<std::string, crossbind::Origin> origins;
std::map<std::string, int> handled;
// The requests of each origin's handler by their paths.
std::map<std::pair<std::string, std::string>, int> handledPaths;
// The stage of the round trip, which outlives each page, and what the pages report for the conformance page.
std::string stage = "start";
Value::Object reports;
std::vector<Call> waiting;
std::atomic<int> projectCancels{0};
std::atomic<int> appOnlyRuns{0};

// A decoded path escaped again, as a URL's path holds it.
std::string escaped(const std::string &path) {
    static const std::string KEPT = "-._~!$&'()*+,;=:@/";
    std::string out;
    for (const unsigned char c : path) {
        if (std::isalnum(c) || KEPT.find(static_cast<char>(c)) != std::string::npos) {
            out += static_cast<char>(c);
            continue;
        }
        char hex[4];
        std::snprintf(hex, sizeof hex, "%%%02X", c);
        out += hex;
    }
    return out;
}

// Each GET and HEAD of the origin is a fetch of its source with the request's Accept, Accept-Language and Range alone,
// and a preview's gate token where it has one. The answer passes with its status and the headers PASSED names; a
// failure, and a redirect elsewhere, which no web view follows for an app's origin, answer 502 with the reason.
void proxy(const std::string &name, const std::string &source, const std::string &previewToken, crossbind::Request request) {
    {
        std::lock_guard<std::mutex> lock(originsMutex);
        handled[name] += 1;
        handledPaths[{name, request.path()}] += 1;
    }
    // A Content-Length that is no number of bytes, which respond() passes on for no answer.
    if (request.path() == "/__e2e/head-length") {
        request.respond(200, {{"Content-Length", "-5"}});
        return;
    }
    const bool isDown = request.path().rfind("/down/", 0) == 0;
    const std::string url = (isDown ? DOWN_SOURCE : source) + escaped(request.path()) + (request.query().empty() ? "" : "?" + request.query());
    crossbind::Request::Headers headers;
    if (!previewToken.empty()) headers.emplace_back("X-Crossbind-Preview", previewToken);
    for (const char *header : {"Accept", "Accept-Language", "Range"}) {
        const std::string value = request.header(header);
        if (!value.empty()) headers.emplace_back(header, value);
    }
    crossbind::fetch(request.method(), url, headers, [request](std::optional<std::string> failure, crossbind::FetchResponse answer) {
        if (failure) {
            request.respond(502, TEXT, *failure);
            return;
        }
        if (answer.status >= 300 && answer.status < 400) {
            request.respond(502, TEXT, "the source answered " + std::to_string(answer.status));
            return;
        }
        crossbind::Request::Headers passed;
        for (const auto &[header, value] : answer.headers) {
            if (PASSED.count(header) > 0) passed.emplace_back(header, value);
        }
        request.respond(answer.status, passed, std::move(answer.body));
    });
}

void addOriginFunctions(crossbind::Registry &registry) {
    // Serves an origin of the role project under this name, whose handler is the proxy of the source given, the run's
    // endpoint's page by default, with a preview's gate token and a label where they are given, and gives its URL.
    registry.function("probe.serveOrigin", [](Call call) {
        const std::string name = call.options()["name"].asString();
        const std::string source = call.options()["source"].asString(SOURCE);
        const std::string previewToken = call.options()["previewToken"].asString("");
        const auto handler = [name, source, previewToken](crossbind::Request request) { proxy(name, source, previewToken, std::move(request)); };
        const Value &label = call.options()["label"];
        const crossbind::Origin origin =
            label.isNull() ? crossbind::serveOrigin(name, "project", handler) : crossbind::serveOrigin(name, "project", handler, label.asString());
        std::lock_guard<std::mutex> lock(originsMutex);
        origins.insert_or_assign(name, origin);
        call.resolve(origin.url());
    });
    // Ends the origin of this name at once, or after afterMs on a thread of its own, as an app's own code would.
    registry.function("probe.endOrigin", PAGES, [](Call call) {
        const std::string name = call.options()["name"].asString();
        const double afterMs = call.options()["afterMs"].asNumber(0);
        std::optional<crossbind::Origin> ending;
        {
            std::lock_guard<std::mutex> lock(originsMutex);
            const auto found = origins.find(name);
            if (found != origins.end()) ending = found->second;
            origins.erase(name);
        }
        if (!ending) {
            call.reject("crossbind: the probe serves no origin " + name);
            return;
        }
        if (afterMs <= 0) {
            ending->end();
        } else {
            std::thread([origin = *ending, afterMs] {
                std::this_thread::sleep_for(std::chrono::duration<double, std::milli>(afterMs));
                origin.end();
            }).detach();
        }
        call.resolve();
    });
    // How many requests of the origin of this name its handler got, or of this path alone.
    registry.function("probe.handled", [](Call call) {
        const std::string name = call.options()["name"].asString();
        const std::string path = call.options()["path"].asString("");
        std::lock_guard<std::mutex> lock(originsMutex);
        call.resolve(path.empty() ? handled[name] : handledPaths[{name, path}]);
    });
    // What serveOrigin() refuses: the name app, a name served now, a name of other letters, one of 64, and the role app.
    registry.function("probe.refusedOrigins", [](Call call) {
        const auto refuse = [](crossbind::Request request) { request.respond(404); };
        const std::vector<std::pair<std::string, std::string>> tries{
            {"app", "project"}, {call.options()["served"].asString(), "project"}, {"e2e_x", "project"}, {std::string(64, 'a'), "project"}, {"e2e-x", "app"}};
        Value::Array refusals;
        for (const auto &[name, role] : tries) {
            try {
                crossbind::serveOrigin(name, role, refuse).end();
                refusals.emplace_back("served " + name + " as " + role);
            } catch (const std::exception &error) {
                refusals.emplace_back(std::string(error.what()));
            }
        }
        call.resolve(Value(std::move(refusals)));
    });
}

void addPageFunctions(crossbind::Registry &registry) {
    // The role of the page that calls, which a page of each role reaches.
    registry.function("probe.role", PAGES, [](Call call) { call.resolve(call.page().role()); });
    // A task of the main thread's, which answers once the main thread runs it, as it does not while a dialog's modal loop
    // holds the main queue. Android's dialogs hold none, and its host has no main thread of its own.
    registry.function("probe.onMainThread", PAGES, [](Call call) {
#if defined(__ANDROID__)
        call.resolve();
#else
        crossbind::onMainThread([call] { call.resolve(); });
#endif
    });
    // The label of the page that calls, and the app's name.
    registry.function("probe.label", PAGES, [](Call call) { call.resolve(Value::Object{{"label", call.page().label()}, {"appName", crossbind::appName()}}); });
    // probe.every for every page, which pages of the role app alone hear, and probe.mine for the calling page, whatever
    // its role.
    registry.function("probe.emitBoth", PAGES, [events = registry.events()](Call call) {
        events.emit("every");
        events.emit("mine", {}, call.page());
        call.resolve();
    });
    // A call of a project's page that answers nothing until it is cancelled, as its origin's end cancels it.
    registry.function("probe.projectWait", {"project"}, [](Call call) {
        call.onCancel([] { projectCancels += 1; });
        std::lock_guard<std::mutex> lock(originsMutex);
        waiting.push_back(call);
    });
    registry.function("probe.projectCancels", [](Call call) { call.resolve(projectCancels.load()); });
    // A function of the app's pages alone, whose runs a page of each role reads: one the host refused never ran.
    registry.function("probe.appOnly", [](Call call) {
        appOnlyRuns += 1;
        call.resolve();
    });
    registry.function("probe.appOnlyRuns", PAGES, [](Call call) { call.resolve(appOnlyRuns.load()); });
    // Windows posts a reply to whatever page the webview shows. The app's page calls these as it opens the project's:
    // one holds up the module's thread, as a function must not, so that its answer and the cancel of the other, which
    // answers nothing, come once the project's page shows, which must hear neither.
    registry.function("probe.holdUp", [](Call call) {
        std::this_thread::sleep_for(std::chrono::duration<double, std::milli>(call.options()["ms"].asNumber(0)));
        call.resolve(std::string("held up for the app's page"));
    });
    registry.function("probe.appWaits", [](Call call) {
        std::lock_guard<std::mutex> lock(originsMutex);
        waiting.push_back(call);
    });
    registry.function("probe.stage", PAGES, [](Call call) {
        std::lock_guard<std::mutex> lock(originsMutex);
        call.resolve(stage);
    });
    registry.function("probe.setStage", PAGES, [](Call call) {
        std::lock_guard<std::mutex> lock(originsMutex);
        stage = call.options()["stage"].asString();
        call.resolve();
    });
    registry.function("probe.report", PAGES, [](Call call) {
        std::lock_guard<std::mutex> lock(originsMutex);
        reports.emplace_back(call.options()["key"].asString(), call.options()["value"]);
        call.resolve();
    });
    registry.function("probe.reports", PAGES, [](Call call) {
        std::lock_guard<std::mutex> lock(originsMutex);
        call.resolve(Value(reports));
    });
    // The message dialog a page showed, closed as its user would: whether one of the message showed, and the title of its
    // window where the platform shows one.
    registry.function("probe.closeDialog", PAGES, [](Call call) {
        closeMessageDialog(call.options()["message"].asString(),
            [call](bool isShown, const std::string &title) { call.resolve(Value::Object{{"isShown", isShown}, {"title", title}}); });
    });
}

// The host's fetch() of a URL, with a body where one is given: its status, headers, size and short text, whether its
// bytes are those the endpoint makes, and how long it took; or why it failed, and how long that took.
void addFetch(crossbind::Registry &registry) {
    registry.function("probe.fetch", [](Call call) {
        const Value &options = call.options();
        crossbind::Request::Headers headers;
        if (options["headers"].isObject()) {
            for (const auto &[name, value] : options["headers"].asObject()) headers.emplace_back(name, value.asString());
        }
        const bool isPatterned = options["pattern"].asBool(false);
        const auto started = std::chrono::steady_clock::now();
        crossbind::fetch(options["method"].asString("GET"), options["url"].asString(), headers, options["body"].asString(""),
            [call, isPatterned, started](std::optional<std::string> failure, crossbind::FetchResponse answer) {
                const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                if (failure) {
                    call.resolve(Value::Object{{"failure", *failure}, {"ms", ms}});
                    return;
                }
                Value::Object received;
                for (const auto &[name, value] : answer.headers) received.emplace_back(name, value);
                bool isPattern = isPatterned;
                for (size_t i = 0; isPattern && i < answer.body.size(); i += 1) isPattern = static_cast<unsigned char>(answer.body[i]) == i % PATTERN;
                call.resolve(Value::Object{{"status", answer.status}, {"headers", Value(std::move(received))}, {"size", static_cast<double>(answer.body.size())},
                    {"text", answer.body.size() <= 512 ? Value(answer.body) : Value()}, {"isPattern", isPattern}, {"ms", ms}});
            });
    });
}

}  // namespace

void probeOrigins(crossbind::Registry &registry) {
    addOriginFunctions(registry);
    addPageFunctions(registry);
    addFetch(registry);
}

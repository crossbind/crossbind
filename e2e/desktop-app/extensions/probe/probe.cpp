// What the page reaches through the shell beside what the app's own code does: a folder outside the app's folders, which
// the page reaches once it is allowed, as a dialog allows what its user picked, and the app's own code at once. And the
// links of the probe's own scheme, which reach it and not the page, its URLs, and calls with messages, cancels and bytes.
#include "crossbind/app.h"
#include "crossbind/extension.h"
#include "probe.h"

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

std::string text(const std::filesystem::path &path) {
    const std::u8string utf8 = path.u8string();
    return std::string(utf8.begin(), utf8.end());
}

std::mutex linksMutex;
std::vector<std::string> links;

std::atomic<int> pages{0};
std::atomic<uint64_t> lastPage{0};
// The thread onPage ran on last.
std::atomic<std::thread::id> pageThread{};
std::atomic<int> closes{0};
std::atomic<int> actives{0};
std::atomic<bool> isActive{false};
// Why the host refused the probe a function of another's name, and a hook of a role it does not hold, as the probe
// starts.
std::string refusedName;
std::string refusedRole;
// How often the probe started and saw a window open, whether it started first, and whether the last window it saw is
// the app's.
std::atomic<int> starts{0};
std::atomic<int> windows{0};
std::atomic<bool> isStartFirst{false};
std::atomic<bool> isAppWindow{false};
// The calls that wait for their cancel, and the cancels the probe heard of.
std::mutex waitingMutex;
std::vector<crossbind::Call> waiting;
std::atomic<int> cancels{0};

// The file the probe's route serves, in the app's own folder, which a phone's app writes too.
std::filesystem::path routeFile() {
    const std::string cache = crossbind::app::paths().cache;
    return std::filesystem::path(std::u8string(cache.begin(), cache.end())) / "crossbind-probe-route.bin";
}

constexpr size_t ROUTE_FILE_BYTES = 10000;

}  // namespace

void crossbind_extension_probe(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    // The host holds each as the event probe.url, which src/main.js asks for with events.held(), until its page asks, and
    // pushes the later ones while it listens; the probe keeps them too, for probe.urls to count.
    registry.onOpenUrl([events = registry.events()](const crossbind::OpenUrl &open) {
        {
            std::lock_guard<std::mutex> lock(linksMutex);
            links.push_back(open.url);
        }
        events.hold("url", Value::Object{{"url", open.url}});
    });
    registry.function("probe.urls", [](Call call) {
        std::lock_guard<std::mutex> lock(linksMutex);
        call.resolve(Value(links));
    });
    // A tap of the probe's quick action on a phone's icon, which the page hears of as the event probe.shortcut.
    registry.onShortcutItem([events = registry.events()](const crossbind::ShortcutItem &item) {
        events.emit("shortcut", Value::Object{{"type", item.type}});
        return true;
    });
    // The files of the probe's type, which the host holds for the page as the event probe.files, and what one holds.
    registry.onOpenFiles([events = registry.events()](const crossbind::OpenFiles &open) {
        events.hold("files", Value::Object{{"paths", open.paths}});
    });
    registry.function("probe.readFile", [](Call call) {
        crossbind::inBackground(call, [path = call.options()["path"].asString()] {
            std::ifstream file(std::filesystem::path(std::u8string(path.begin(), path.end())));
            if (!file) throw std::runtime_error("crossbind: the probe cannot read " + path);
            return Value(std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()));
        });
    });
    // A folder outside the app's, with a file for the page's trash and one for the app's own code's.
    registry.function("probe.folder", [](Call call) {
        crossbind::inBackground(call, [] {
            const std::filesystem::path folder = std::filesystem::temp_directory_path() / "crossbind-e2e-probe";
            std::filesystem::create_directories(folder);
            for (const char *name : {"page.txt", "app.txt"}) {
                std::ofstream file(folder / name);
                file << "crossbind";
                if (!file) throw std::runtime_error("crossbind: the probe cannot write " + text(folder / name));
            }
            return Value(text(folder));
        });
    });
    registry.function("probe.allowPath", [](Call call) {
        crossbind::allowPath(call.options()["path"].asString());
        call.resolve();
    });
    // The app's own code reaches any path through <crossbind/app.h>, and hears of a relative one by its own names.
    registry.function("probe.trash", [](Call call) {
        crossbind::inBackground(call, [path = call.options()["path"].asString()] {
            crossbind::app::trash(path);
            return Value();
        });
    });
    registry.function("probe.openRelative", [](Call call) {
        crossbind::inBackground(call, [] {
            try {
                crossbind::app::openPath("crossbind-relative");
            } catch (const std::exception &error) {
                return Value(error.what());
            }
            return Value("opened");
        });
    });
    // The app's own code asks the host's updater as the page does.
    registry.function("probe.checkForUpdate", [](Call call) {
        crossbind::inBackground(call, [] {
            const std::optional<std::string> version = crossbind::app::checkForUpdate();
            return version ? Value(*version) : Value();
        });
    });
    // The probe's C source, compiled with the folder of its includes and its macros.
    registry.function("probe.compiled", [](Call call) { call.resolve(crossbind_probe_sum(2, 3)); });
    // What the app carries of the probe's and of its own, by the folders the host names.
    registry.function("probe.carried", [files = registry.files()](Call call) {
        const auto textOf = [](const std::string &path) {
            std::ifstream file(path, std::ios::binary);
            return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
        };
        call.resolve(Value::Object{{"extension", textOf(files + "/carried/probe.txt")}, {"app", textOf(crossbind::app::paths().resources + "/e2e/carried.txt")}});
    });
    // Text that is no UTF-8, which the page reads with U+FFFD in its place.
    registry.function("probe.invalidUtf8", [](Call call) { call.resolve(Value(std::string("a\xff" "b"))); });
    // Whether the page made the call, as it does this one, and not the probe through invoke().
    registry.function("probe.fromPage", [](Call call) { call.resolve(call.isFromPage()); });
    registry.function("probe.invokeOwn", [](Call call) {
        crossbind::invoke("probe.fromPage", Value::Object{}, [call](std::optional<std::string> failure, Value result) {
            if (failure) call.reject(*failure);
            else call.resolve(std::move(result));
        });
    });
    // Each page the app starts, its first one too, on the thread of the page's calls, which come from the page started
    // last.
    registry.onPage([](const crossbind::Page &page) {
        pageThread = std::this_thread::get_id();
        lastPage = page.id();
        pages += 1;
    });
    registry.function("probe.pages", [](Call call) {
        call.resolve(Value::Object{{"count", pages.load()}, {"isCallThread", pageThread.load() == std::this_thread::get_id()},
                                   {"isCallPage", call.page().id() == lastPage.load() && call.page().id() != 0}});
    });
    // A function's name starts with its extension's.
    try {
        registry.function("other.name", [](Call call) { call.resolve(); });
    } catch (const std::invalid_argument &error) {
        refusedName = error.what();
    }
    registry.function("probe.refusedName", [](Call call) { call.resolve(refusedName); });
    // The page's downloads go to the holder of page-downloads alone.
    try {
        registry.onDownload([](crossbind::Download download) { download.useDefault(); });
    } catch (const std::logic_error &error) {
        refusedRole = error.what();
    }
    registry.function("probe.refusedRole", [](Call call) { call.resolve(refusedRole); });
    // It holds an event before the module starts, which the page gets once it asks.
    registry.onStart([events = registry.events()] {
        starts += 1;
        isStartFirst = windows.load() == 0;
        events.hold("started", Value::Object{{"isStartFirst", isStartFirst.load()}});
    });
    registry.onWindow([]([[maybe_unused]] const crossbind::Window &window) {
        windows += 1;
#if !defined(__ANDROID__)
        isAppWindow = window.id() != 0 && window.native() == crossbind::appWindow() && window.webView() == crossbind::appWebView();
#endif
    });
    registry.function("probe.lifecycle", [](Call call) {
        call.resolve(Value::Object{{"starts", starts.load()}, {"isStartFirst", isStartFirst.load()}, {"windows", windows.load()},
                                   {"isAppWindow", isAppWindow.load()}, {"appId", crossbind::appId()}});
    });
    // The probe's URLs: a text it answers whole, with the query and a header it was asked with; a file the host reads,
    // under a path the route gets decoded; and a request it lets go of unanswered.
    registry.route([](crossbind::Request request) {
        if (request.path() == "/hello.txt") {
            request.respond(200,
                {{"Content-Type", "text/plain; charset=utf-8"}, {"X-Probe-Header", request.header("X-PROBE")}, {"X-Probe-Page", request.page().id() != 0 ? "yes" : "no"}},
                "hello " + request.query());
        } else if (request.path() == "/a b/file.bin") {
            request.respondFile(text(routeFile()));
        } else if (request.path() != "/unanswered") {
            request.respond(404, {}, "the probe serves no " + request.path());
        }
    });
    registry.function("probe.routeFile", [](Call call) {
        crossbind::inBackground(call, [] {
            std::string bytes(ROUTE_FILE_BYTES, '\0');
            for (size_t i = 0; i < bytes.size(); i += 1) bytes[i] = static_cast<char>(i % 251);
            std::ofstream file(routeFile(), std::ios::binary);
            file << bytes;
            if (!file) throw std::runtime_error("crossbind: the probe cannot write " + text(routeFile()));
            return Value(static_cast<double>(bytes.size()));
        });
    });
    // Messages before the answer, each with a byte of its own, from a thread of the probe's.
    registry.function("probe.count", [](Call call) {
        std::thread([call] {
            const int count = static_cast<int>(call.options()["count"].asNumber(0));
            for (int n = 1; n <= count; n += 1) call.send(Value::Object{{"n", n}, {"bytes", Value::Bytes{static_cast<uint8_t>(n)}}});
            call.resolve("counted");
        }).detach();
    });
    // A call that answers nothing until the page cancels it, after it told the page it waits.
    registry.function("probe.wait", [](Call call) {
        call.onCancel([] { cancels += 1; });
        call.send("waiting");
        std::lock_guard<std::mutex> lock(waitingMutex);
        waiting.push_back(call);
    });
    registry.function("probe.cancels", [](Call call) { call.resolve(cancels.load()); });
    // The bytes the page passed, reversed, and how many.
    registry.function("probe.bytes", [](Call call) {
        Value::Bytes back = call.options()["data"].asBytes();
        std::reverse(back.begin(), back.end());
        call.resolve(Value::Object{{"size", static_cast<double>(back.size())}, {"back", std::move(back)}});
    });
    // Enough bytes to come back as a large result of their own.
    registry.function("probe.bigBytes", [](Call call) {
        Value::Bytes bytes(100000);
        for (size_t i = 0; i < bytes.size(); i += 1) bytes[i] = static_cast<uint8_t>(i % 251);
        call.resolve(std::move(bytes));
    });
    // The probe keeps the window open whenever its user closes it, as an app that stays in its tray does: the
    // app.relaunch() that ends the run quits as app.quit() does, which asks it nothing.
    registry.onClose([] {
        closes += 1;
        return false;
    });
    registry.function("probe.closes", [](Call call) { call.resolve(closes.load()); });
    // The app's state before its user, which the probe hears of once the window has opened, and the quits asked of the
    // app, which it refuses, telling the page: app.relaunch() quits all the same.
    registry.onActive([](bool active) {
        isActive = active;
        actives += 1;
    });
    registry.function("probe.actives", [](Call call) { call.resolve(actives.load()); });
#if defined(__APPLE__) || defined(_WIN32)
    // The app told it became inactive and active again, or the other way round, as its system tells it, which the page
    // hears in that order: the probe answers whether the app was active.
    registry.function("probe.flipActive", [](Call call) {
        crossbind::onMainThread([call] {
            const bool was = isActive;
            tellActive(!was);
            tellActive(was);
            call.resolve(was);
        });
    });
#endif
    registry.onQuitRequest([events = registry.events()] {
        events.emit("quit-request");
        return false;
    });
#if !defined(__ANDROID__)
    // A task on the main thread that throws leaves the app running, and the call it held fails as it lets go of it.
    registry.function("probe.throwOnMain", [](Call call) {
        crossbind::onMainThread([call] { throw std::runtime_error("the probe's task fails"); });
    });
    // <crossbind/app.h> refuses the main thread, which answers its waits.
    registry.function("probe.waitOnMain", [](Call call) {
        crossbind::onMainThread([call] {
            try {
                crossbind::app::openExternal("https://example.com/");
                call.resolve("opened");
            } catch (const std::exception &error) {
                call.resolve(error.what());
            }
        });
    });
#endif
    probePlatform(registry);
}

// What the page reaches through the shell beside what the app's own code does: a folder outside the app's folders, which
// the page reaches once it is allowed, as a dialog allows what its user picked, and the app's own code at once. And the
// links of the probe's own scheme, which reach it and not the page.
#include "crossbind/app.h"
#include "crossbind/extension.h"
#include "probe.h"

#include <atomic>
#include <filesystem>
#include <fstream>
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
// The thread onPage ran on last.
std::atomic<std::thread::id> pageThread{};
std::atomic<int> closes{0};
// Why the host refused the probe a function of another's name, as the probe starts.
std::string refusedName;

}  // namespace

void crossbind_extension_probe(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    // The host holds each as the event probe-url, which src/main.js asks for with events.held(), until its page asks, and
    // pushes the later ones while it listens; the probe keeps them too, for probe.urls to count.
    registry.onUrl([](const std::string &url) {
        {
            std::lock_guard<std::mutex> lock(linksMutex);
            links.push_back(url);
        }
        crossbind::app::holdEvent("probe-url", Value(Value::Object{{"url", url}}).json());
    });
    registry.function("probe.urls", [](Call call) {
        std::lock_guard<std::mutex> lock(linksMutex);
        call.resolve(Value(links));
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
    // Each page the app starts, its first one too, on the thread of the page's calls.
    registry.onPage([] {
        pageThread = std::this_thread::get_id();
        pages += 1;
    });
    registry.function("probe.pages", [](Call call) {
        call.resolve(Value::Object{{"count", pages.load()}, {"isCallThread", pageThread.load() == std::this_thread::get_id()}});
    });
    // A function's name starts with its extension's.
    try {
        registry.function("other.name", [](Call call) { call.resolve(); });
    } catch (const std::invalid_argument &error) {
        refusedName = error.what();
    }
    registry.function("probe.refusedName", [](Call call) { call.resolve(refusedName); });
    // The probe keeps the window open whenever its user closes it, as an app that stays in its tray does: the
    // app.relaunch() that ends the run quits as app.quit() does, which asks it nothing.
    registry.onClose([] {
        closes += 1;
        return false;
    });
    registry.function("probe.closes", [](Call call) { call.resolve(closes.load()); });
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

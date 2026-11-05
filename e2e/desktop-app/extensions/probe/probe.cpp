// What the page reaches through the shell beside what the app's own code does: a folder outside the app's folders, which
// the page reaches once it is allowed, as a dialog allows what its user picked, and the app's own code at once. And the
// links of the probe's own scheme, which reach it and not the page.
#include "crossbind/app.h"
#include "crossbind/extension.h"

#include <filesystem>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace {

std::string text(const std::filesystem::path &path) {
    const std::u8string utf8 = path.u8string();
    return std::string(utf8.begin(), utf8.end());
}

std::mutex linksMutex;
std::vector<std::string> links;

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
}

// The origin e2e-served, of the label its options give, as a project's page: an alert, which waits for its user as the
// origin ends, a while after its page was asked for. The host's own page-dialogs titles the alert with the label and
// closes it as the origin ends, and the app's own page comes back.
#include "crossbind/extension.h"

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace {

// Long enough for e2e/run.mjs to find the alert by its title, which it looks for every 200 ms.
constexpr auto END_AFTER = std::chrono::seconds(5);
constexpr const char *PAGE = "<!doctype html><meta charset=\"utf-8\"><script>alert('Served');</script>";

std::mutex servedMutex;
std::optional<crossbind::Origin> served;
std::once_flag ending;

void endLater() {
    std::thread([] {
        std::this_thread::sleep_for(END_AFTER);
        std::optional<crossbind::Origin> origin;
        {
            std::lock_guard<std::mutex> lock(servedMutex);
            origin.swap(served);
        }
        if (origin) origin->end();
    }).detach();
}

}  // namespace

void crossbind_extension_e2e_served(crossbind::Registry &registry) {
    registry.onStart([label = registry.options()["label"].asString("")] {
        crossbind::Origin origin = crossbind::serveOrigin(
            "e2e-served", "project",
            [](crossbind::Request request) {
                std::call_once(ending, endLater);
                request.respond(200, {{"Content-Type", "text/html; charset=utf-8"}}, PAGE);
            },
            label);
        std::lock_guard<std::mutex> lock(servedMutex);
        served = std::move(origin);
    });
}

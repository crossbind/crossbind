// Every navigation beyond the app's origins is refused, as src/main.js asks for some; page-navigation.asked gives what
// each asked.
#include "crossbind/extension.h"

#include <mutex>

namespace {

std::mutex askedMutex;
crossbind::Value::Array asked;

}  // namespace

void crossbind_extension_e2e_page_navigation(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.onNavigation([](const crossbind::Navigation &navigation) {
        {
            std::lock_guard<std::mutex> lock(askedMutex);
            asked.emplace_back(Value::Object{{"url", navigation.url()},
                {"isMainFrame", navigation.isMainFrame()},
                {"isUserInitiated", navigation.isUserInitiated()},
                {"isNewWindow", navigation.isNewWindow()}, {"isPage", navigation.page().id() != 0}});
        }
        return crossbind::NavigationAnswer::refuse;
    });
    registry.function("page-navigation.asked", [](Call call) {
        std::lock_guard<std::mutex> lock(askedMutex);
        call.resolve(Value(asked));
    });
}

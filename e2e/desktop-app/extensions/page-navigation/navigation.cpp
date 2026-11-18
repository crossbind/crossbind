// Every navigation beyond the app's origins is refused, as src/main.js asks for some; page-navigation.asked gives what
// each asked, to a page of the app's and of a project's, whose page src/main.js runs at the probe's origin.
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
                {"isNewWindow", navigation.isNewWindow()}, {"isPage", navigation.page().id() != 0}, {"role", navigation.page().role()}});
        }
        return crossbind::NavigationAnswer::refuse;
    });
    registry.function("page-navigation.asked", {"app", "project"}, [](Call call) {
        std::lock_guard<std::mutex> lock(askedMutex);
        call.resolve(Value(asked));
    });
}

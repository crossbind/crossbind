// Every navigation beyond the app's origins is refused, as src/main.js asks for some, but the page of no role that
// src/served-origins.js opens, without a refused= in its query, the second it goes to on Android, and their way back to
// the app's, which load; page-navigation.asked gives what each asked, to a page of the app's and of a project's, whose
// page src/main.js runs at the probe's origin. On Android, as it loads a page of no role, the UI thread's Java messages
// wait, so the host hears of that page only after its POSTs and its first link, as it may of any page.
#include "crossbind/extension.h"

#include <mutex>
#include <optional>
#include <string>

namespace {

#if defined(__ANDROID__)
// Past the POSTs of the page of no role, 1.5 s apart, and the second's first link.
constexpr double NO_ROLE_HOLD_MS = 2000;
#endif

std::mutex askedMutex;
crossbind::Value::Array asked;

bool isLoaded(const crossbind::Navigation &navigation) {
    const std::string &url = navigation.url();
    const std::string &role = navigation.page().role();
    const bool isNoRolePage = url.find("/page/no-role.html?") != std::string::npos && url.find("&refused=") == std::string::npos;
    const bool isSecond = url.find("&second=1") != std::string::npos;
    return (isNoRolePage && role == (isSecond ? "" : "app")) || (role.empty() && url.find("/?from=no-role-back&") != std::string::npos);
}

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
        if (!isLoaded(navigation)) return crossbind::NavigationAnswer::refuse;
#if defined(__ANDROID__)
        // The UI thread takes this after the answer, before the page's start.
        if (navigation.url().find("/page/no-role.html?") != std::string::npos) {
            crossbind::android::callJava("probe", "holdUi", Value::Object{{"ms", NO_ROLE_HOLD_MS}}, [](std::optional<std::string>, Value) {});
        }
#endif
        return crossbind::NavigationAnswer::load;
    });
    registry.function("page-navigation.asked", {"app", "project"}, [](Call call) {
        std::lock_guard<std::mutex> lock(askedMutex);
        call.resolve(Value(asked));
    });
}

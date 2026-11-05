#include "crossbind/extension.h"

#include <algorithm>
#include <string>
#include <vector>

namespace {

// A URL's origin as the page's scripts name it: its scheme, its host and the port it names.
std::string originOf(const std::string &url) {
    const auto scheme = url.find("://");
    if (scheme == std::string::npos) return "";
    return url.substr(0, url.find_first_of("/?#", scheme + 3));
}

}  // namespace

// The host's page-navigation: the origins app.navigation.load lists load in the app, a link to another its user follows
// opens outside, and the rest loads nothing. An authentication and a certificate error get no owner, so the host
// cancels each.
void crossbind_extension_page_navigation(crossbind::Registry &registry) {
    std::vector<std::string> loads;
    const crossbind::Value options = registry.options();
    const crossbind::Value &listed = options["load"];
    if (listed.isArray()) {
        for (const crossbind::Value &origin : listed.asArray()) loads.push_back(origin.asString());
    }
    registry.onNavigation([loads](const crossbind::Navigation &navigation) {
        if (std::find(loads.begin(), loads.end(), originOf(navigation.url())) != loads.end()) return crossbind::NavigationAnswer::load;
        return navigation.isUserInitiated() ? crossbind::NavigationAnswer::openOutside : crossbind::NavigationAnswer::refuse;
    });
}

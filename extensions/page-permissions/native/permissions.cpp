#include "crossbind/extension.h"

// The host's page-permissions: the app's own page gets the devices app.permissions lists, and any page of the app's the
// clipboard's text, which a webview asks for on its user's gesture alone, and nothing else, so that no webview asks the
// app's user anything of its own. The system still asks for each device. A page of an origin an extension serves gets
// no device, which a consent of its own would give it.
void crossbind_extension_page_permissions(crossbind::Registry &registry) {
    registry.onPagePermission([](crossbind::PagePermission request) {
        const auto &kinds = request.kinds();
        if ((request.isListed() && request.page().role() == "app") || (kinds.size() == 1 && kinds.front() == "clipboard")) request.allow();
        else request.deny();
    });
}

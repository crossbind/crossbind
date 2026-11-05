#include "crossbind/extension.h"

// The host's page-permissions: the page gets the devices app.permissions lists, and the clipboard's text, which a
// webview asks for on its user's gesture alone, and nothing else, so that no webview asks the app's user anything of
// its own. The system still asks for each device.
void crossbind_extension_page_permissions(crossbind::Registry &registry) {
    registry.onPagePermission([](crossbind::PagePermission request) {
        const auto &kinds = request.kinds();
        if (request.isListed() || (kinds.size() == 1 && kinds.front() == "clipboard")) request.allow();
        else request.deny();
    });
}

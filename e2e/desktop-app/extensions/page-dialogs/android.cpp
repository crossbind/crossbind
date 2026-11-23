// The e2e app's page-dialogs on Android, whose Java takes the page's dialogs: how many of the message "wait" answered as
// cancelled as their page went, which src/served-origins.js asks for.
#include "crossbind/extension.h"

void crossbind_extension_e2e_page_dialogs(crossbind::Registry &registry) {
    registry.function("page-dialogs.cancels", [](crossbind::Call call) { crossbind::android::callJava("e2e-page-dialogs", "cancels", call); });
}

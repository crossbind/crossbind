// The e2e app's page-dialogs on Android, whose Java takes the page's dialogs: the messages of those whose message starts
// with "wait" that it was handed and that answered as cancelled as their page went, which src/served-origins.js asks for.
#include "crossbind/extension.h"

void crossbind_extension_e2e_page_dialogs(crossbind::Registry &registry) {
    registry.function("page-dialogs.heard", [](crossbind::Call call) { crossbind::android::callJava("e2e-page-dialogs", "heard", call); });
}

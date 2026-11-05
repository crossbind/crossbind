// The links of app.urlSchemes, the app's own schemes, which the build gives this extension: the page asks for those that
// came before it listened with crossbind/app's app.launchUrls(), and hears of each later one as the event open-url.
#include "crossbind/app.h"
#include "crossbind/extension.h"

void crossbind_extension_links(crossbind::Registry &registry) {
    registry.onOpenUrl([](const crossbind::OpenUrl &open) {
        crossbind::app::holdEvent("open-url", crossbind::Value(crossbind::Value::Object{{"url", open.url}}).json());
    });
}

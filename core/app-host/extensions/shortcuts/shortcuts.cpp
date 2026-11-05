// The quick actions of app.shortcutItems, the app's own, which the build gives this extension: the page hears of each
// tap of one as the held event shortcut-item, the launch's own among them.
#include "crossbind/app.h"
#include "crossbind/extension.h"

void crossbind_extension_shortcuts(crossbind::Registry &registry) {
    registry.onShortcutItem([](const crossbind::ShortcutItem &item) {
        crossbind::app::holdEvent("shortcut-item", crossbind::Value(crossbind::Value::Object{{"type", item.type}}).json());
        return true;
    });
}

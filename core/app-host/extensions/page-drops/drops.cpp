#include "crossbind/app.h"
#include "crossbind/extension.h"

// The host's page-drops: the page hears of each drop of files as the event drop, of { paths, x, y }, and reaches each
// path through crossbind/app's shell functions, as one its user picked.
void crossbind_extension_page_drops(crossbind::Registry &registry) {
    registry.onDrop([](const crossbind::Drop &drop) {
        crossbind::Value::Array listed;
        for (const auto &path : drop.paths) {
            crossbind::allowPath(path);
            listed.emplace_back(path);
        }
        crossbind::app::emitEvent("drop", crossbind::Value(crossbind::Value::Object{{"paths", crossbind::Value(std::move(listed))}, {"x", drop.x}, {"y", drop.y}}).json());
    });
}

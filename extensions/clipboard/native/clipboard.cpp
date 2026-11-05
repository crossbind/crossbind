// The system clipboard's text, which the page reads and writes through @crossbind/extension-clipboard.
#include "clipboard.h"

#include <stdexcept>
#include <utility>

void crossbind_extension_clipboard(crossbind::Registry &registry) {
    using crossbind::Call;
    registry.function("clipboard.readText", [](Call call) { crossbind::clipboard::readText(std::move(call)); });
    registry.function("clipboard.writeText", [](Call call) {
        const crossbind::Value &text = call.options()["text"];
        if (!text.isString()) throw std::invalid_argument("crossbind: clipboard.writeText takes a string");
        crossbind::clipboard::writeText(call, text.asString());
    });
}

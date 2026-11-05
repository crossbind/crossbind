// The extension's functions, which the page calls through its package, the same on every platform.
#include "crossbind/extension.h"

#include <stdexcept>

void crossbind_extension_starter(crossbind::Registry &registry) {
    registry.function("starter.greet", [](crossbind::Call call) {
        const crossbind::Value &name = call.options()["name"];
        if (!name.isString()) throw std::invalid_argument("crossbind: starter.greet takes a name");
        call.resolve("Hello, " + name.asString() + ", from " + crossbind::appName());
    });
}

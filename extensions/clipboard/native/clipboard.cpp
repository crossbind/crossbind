// The system clipboard's text, which the page reads and writes through @crossbind/extension-clipboard.
#include "clipboard.h"

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A page of the role project, as a project's in the crossbind app, writes the clipboard, and reads it where the system
// tells its user of a read, as iOS asks to paste and Android shows that the app pasted.
#if (defined(__APPLE__) && TARGET_OS_IPHONE) || defined(__ANDROID__)
const std::vector<std::string> READERS{"app", "project"};
#else
const std::vector<std::string> READERS{"app"};
#endif

void crossbind_extension_clipboard(crossbind::Registry &registry) {
    using crossbind::Call;
    registry.function("clipboard.readText", READERS, [](Call call) { crossbind::clipboard::readText(std::move(call)); });
    registry.function("clipboard.writeText", {"app", "project"}, [](Call call) {
        const crossbind::Value &text = call.options()["text"];
        if (!text.isString()) throw std::invalid_argument("crossbind: clipboard.writeText takes a string");
        crossbind::clipboard::writeText(call, text.asString());
    });
}

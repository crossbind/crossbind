#include "dialog.h"

#include <cstdio>
#include <stdexcept>

namespace crossbind::dialog {

void showOpenDialog(app::OpenOptions, std::function<void(Picked)>) { throw std::runtime_error("crossbind: an Android app has no file dialogs yet"); }

void showSaveDialog(app::SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an Android app has no file dialogs yet");
}

// The extension's Java shows it in the activity in front; a dialog nothing could show, as when the activity is gone,
// went without a button.
void showMessageDialog(app::MessageOptions options, std::function<void(int)> done) {
    android::callJava("dialog", "message", {{"message", options.message}, {"detail", options.detail}, {"buttons", options.buttons}},
        [done = std::move(done)](std::optional<std::string> failure, Value result) {
            if (failure) std::fprintf(stderr, "%s\n", failure->c_str());
            done(failure ? NO_BUTTON : static_cast<int>(result.asNumber()));
        });
}

}  // namespace crossbind::dialog

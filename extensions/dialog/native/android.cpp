#include "dialog.h"

#include <cstdio>
#include <stdexcept>

namespace crossbind::dialog {

// The extension's Java shows the system's picker in the activity in front, then copies what its user picked into the
// app's cache, where native code opens it by a path. A pick it could not copy goes as a cancel, said in the log.
void showOpenDialog(uint64_t, OpenOptions options, std::function<void(Picked)> done) {
    if (options.directory) throw std::runtime_error("crossbind: an Android app's open dialog picks files, not folders");
    std::vector<std::string> extensions;
    for (const auto &filter : options.filters) extensions.insert(extensions.end(), filter.extensions.begin(), filter.extensions.end());
    android::callJava("dialog", "open", {{"multiple", options.multiple}, {"extensions", extensions}},
        [done = std::move(done)](std::optional<std::string> failure, Value result) {
            if (failure) std::fprintf(stderr, "%s\n", failure->c_str());
            if (failure || result.isNull()) {
                done(std::nullopt);
                return;
            }
            std::vector<std::string> paths;
            for (const Value &path : result.asArray()) paths.push_back(path.asString());
            done(paths);
        });
}

// A file the page makes reaches its user's folders as a download, which shows the system's save picker.
void showSaveDialog(uint64_t, SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an Android app saves a file as the page's download, which shows the system's save picker, not with dialog.save");
}

// The extension's Java shows it in the activity in front; a dialog nothing could show, as when the activity is gone,
// went without a button.
void showMessageDialog(uint64_t, MessageOptions options, std::function<void(int)> done) {
    android::callJava("dialog", "message", {{"message", options.message}, {"detail", options.detail}, {"buttons", options.buttons}},
        [done = std::move(done)](std::optional<std::string> failure, Value result) {
            if (failure) std::fprintf(stderr, "%s\n", failure->c_str());
            done(failure ? NO_BUTTON : static_cast<int>(result.asNumber()));
        });
}

}  // namespace crossbind::dialog

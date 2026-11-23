#pragma once

// The dialogs each platform shows. Each is called on the module's thread, shows its dialog on the main thread, over the
// window of this id, the calling page's, or the app's oldest for 0, but on macOS, whose panels are the app's, and calls
// done there: a file dialog with what its user picked, or nothing when they cancelled; a message dialog with the index
// of the button clicked, or NO_BUTTON when its user closed it without one. A platform that has no such dialog throws.
#include "crossbind/extension.h"

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace crossbind::dialog {

// What closes a message dialog as its call is cancelled, as one of a page that went would wait for nobody: the platform
// gives what closes the one it shows, as it shows it; close(), from any thread, closes it then, or as it shows. One
// answered takes no close.
class Closer {
public:
    void shown(std::function<void()> close) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (!isClosed_) {
                close_ = std::move(close);
                return;
            }
        }
        close();
    }
    void close() {
        std::function<void()> closing;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            isClosed_ = true;
            closing.swap(close_);
        }
        if (closing) closing();
    }
    void answered() {
        std::lock_guard<std::mutex> lock(mutex_);
        close_ = nullptr;
    }

private:
    std::mutex mutex_;
    std::function<void()> close_;
    bool isClosed_ = false;
};

// A kind of file a dialog offers: its name, and the extensions, with or without the dot, that make it; "*" is any file.
struct FileFilter {
    std::string name;
    std::vector<std::string> extensions;
};

struct OpenOptions {
    std::string title;
    // The folder the dialog shows first.
    std::string defaultPath;
    std::vector<FileFilter> filters;
    // Folders instead of files.
    bool directory = false;
    bool multiple = false;
};

struct SaveOptions {
    std::string title;
    // The folder the dialog shows first.
    std::string defaultPath;
    std::string defaultName;
    std::vector<FileFilter> filters;
};

enum class MessageKind { info, warning, error };

struct MessageOptions {
    // What Windows and Linux title its window with: the label of the calling page, the app's name for the app's own.
    std::string title;
    std::string message;
    // Smaller text under the message.
    std::string detail;
    // Windows shows its icon for each, and macOS a caution sign for error; Linux, iOS and Android show none.
    MessageKind kind = MessageKind::info;
    // One to three labels, the first the default; none is OK.
    std::vector<std::string> buttons;
    // Whether it holds the whole app, as for the app's own pages and its native code, or the calling page's window
    // alone, as a project's does: a sheet of the window on macOS.
    bool isAppModal = true;
    // What closes it as its call is cancelled; none for one nothing cancels.
    std::shared_ptr<Closer> closer;
};

using Picked = std::optional<std::vector<std::string>>;
constexpr int NO_BUTTON = -1;

void showOpenDialog(uint64_t window, OpenOptions options, std::function<void(Picked)> done);
void showSaveDialog(uint64_t window, SaveOptions options, std::function<void(std::optional<std::string>)> done);
void showMessageDialog(uint64_t window, MessageOptions options, std::function<void(int)> done);

}  // namespace crossbind::dialog

#pragma once

// The dialogs each platform shows. Each is called on the module's thread, shows its dialog on the main thread, over the
// window of this id, the calling page's, or the app's oldest for 0, but on macOS, whose panels are the app's, and calls
// done there: a file dialog with what its user picked, or nothing when they cancelled; a message dialog with the index
// of the button clicked, or NO_BUTTON when its user closed it without one. A platform that has no such dialog throws.
#include "crossbind/extension.h"

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace crossbind::dialog {

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
    std::string message;
    // Smaller text under the message.
    std::string detail;
    // Windows shows its icon for each, and macOS a caution sign for error; Linux, iOS and Android show none.
    MessageKind kind = MessageKind::info;
    // One to three labels, the first the default; none is OK.
    std::vector<std::string> buttons;
};

using Picked = std::optional<std::vector<std::string>>;
constexpr int NO_BUTTON = -1;

void showOpenDialog(uint64_t window, OpenOptions options, std::function<void(Picked)> done);
void showSaveDialog(uint64_t window, SaveOptions options, std::function<void(std::optional<std::string>)> done);
void showMessageDialog(uint64_t window, MessageOptions options, std::function<void(int)> done);

}  // namespace crossbind::dialog

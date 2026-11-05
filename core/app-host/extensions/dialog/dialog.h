#pragma once

// The dialogs each platform shows. Each is called on the module's thread, shows its dialog on the main thread, over the
// window of this id, the calling page's, or the app's oldest for 0, but on macOS, whose panels are the app's, and calls
// done there: a file dialog with what its user picked, or nothing when they cancelled; a message dialog with the index
// of the button clicked, or NO_BUTTON when its user closed it without one. A platform that has no such dialog throws.
#include "crossbind/app.h"
#include "crossbind/extension.h"

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace crossbind::dialog {

using Picked = std::optional<std::vector<std::string>>;
constexpr int NO_BUTTON = -1;

void showOpenDialog(uint64_t window, app::OpenOptions options, std::function<void(Picked)> done);
void showSaveDialog(uint64_t window, app::SaveOptions options, std::function<void(std::optional<std::string>)> done);
void showMessageDialog(uint64_t window, app::MessageOptions options, std::function<void(int)> done);

}  // namespace crossbind::dialog

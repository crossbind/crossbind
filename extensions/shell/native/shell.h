#pragma once

// What each platform does for the shell. Each is called on the module's thread, works on the main thread and calls done
// there with why it failed, or nothing. A platform that has no such function throws.
#include "crossbind/extension.h"

#include <functional>
#include <optional>
#include <string>

namespace crossbind::shell {

using Done = std::function<void(std::optional<std::string>)>;

// An http, https or mailto address, which the caller has checked.
void openUrl(std::string url, Done done);
void openFile(std::string path, Done done);
void revealFile(std::string path, Done done);
// Moves a file or folder to the system's trash. Where it has no trash, as on a network share, it moves nothing and fails.
void trashFile(std::string path, Done done);

}  // namespace crossbind::shell

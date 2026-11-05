#pragma once

// The clipboard each platform has. Each is called on the module's thread and answers the call: readText with the text
// the clipboard holds, or "" when it holds none, and writeText once the clipboard holds the text.
#include "crossbind/extension.h"

#include <string>

namespace crossbind::clipboard {

void readText(Call call);
void writeText(Call call, std::string text);

}  // namespace crossbind::clipboard

// The shell on Android, which has none of its functions yet.
#include "shell.h"

#include <stdexcept>

namespace crossbind::shell {

void openUrl(std::string, Done) { throw std::runtime_error("crossbind: an Android app opens no address outside itself yet"); }

void openFile(std::string, Done) { throw std::runtime_error("crossbind: an Android app opens no file in another app yet"); }

void revealFile(std::string, Done) { throw std::runtime_error("crossbind: an Android app has no file manager to show a file in"); }

void trashFile(std::string, Done) { throw std::runtime_error("crossbind: an Android app has no trash to move a file to"); }

}  // namespace crossbind::shell

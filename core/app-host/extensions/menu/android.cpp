// An Android app has no menu bar and no tray icon, opens no menu of the page's, and shows no notifications yet.
#include "menu.h"

#include <stdexcept>

namespace crossbind::menu {

void setMenu(std::vector<MenuItem>, MenuClicked, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app has no menu bar");
}

void popupMenu(std::vector<MenuItem>, double, double, std::function<void(Failure, std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an Android app opens no menu of the page's");
}

void setDockMenu(std::vector<MenuItem>, MenuClicked, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: a macOS app alone has a Dock menu");
}

void setTray(TrayOptions, MenuClicked, std::function<void(Failure)>) { throw std::runtime_error("crossbind: an Android app has no tray icon"); }

void removeTray(std::function<void(Failure)>) { throw std::runtime_error("crossbind: an Android app has no tray icon"); }

void showNotification(Notification, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app shows no notifications yet");
}

}  // namespace crossbind::menu

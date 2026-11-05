#import <UIKit/UIKit.h>

#include "dialog.h"

#include <memory>
#include <stdexcept>

namespace crossbind::dialog {
namespace {

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void onMain(void (^block)(void)) { dispatch_async(dispatch_get_main_queue(), block); }

// A message dialog's answer, given once. UIKit can let an alert go without a click, as when its scene goes, and then
// the last of its actions to go answers it as closed.
struct MessageAnswer {
    std::function<void(int)> done;
    bool isGiven = false;

    void give(int button) {
        if (isGiven) return;
        isGiven = true;
        done(button);
    }
    ~MessageAnswer() { give(NO_BUTTON); }
};

// Over whatever the window of this id, or the app's oldest, shows on top; false when it has nothing to show it over.
bool presentOnTop(UIViewController *controller, uint64_t window) {
    const std::optional<Window> open = windowOf(window);
    UIViewController *top = ((__bridge UIWindow *)(open ? open->native() : appWindow())).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (!top || top.isBeingDismissed) return false;
    [top presentViewController:controller animated:YES completion:nil];
    return true;
}

}  // namespace

void showOpenDialog(uint64_t, app::OpenOptions, std::function<void(Picked)>) { throw std::runtime_error("crossbind: an iOS app has no file dialogs yet"); }

void showSaveDialog(uint64_t, app::SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an iOS app has no file dialogs yet");
}

// The last of several buttons is the one a keyboard's Escape clicks, which iOS places where its apps put Cancel.
void showMessageDialog(uint64_t window, app::MessageOptions options, std::function<void(int)> done) {
    onMain(^{
      auto answer = std::make_shared<MessageAnswer>();
      answer->done = done;
      UIAlertController *alert = [UIAlertController alertControllerWithTitle:ns(options.message)
                                                                     message:options.detail.empty() ? nil : ns(options.detail)
                                                              preferredStyle:UIAlertControllerStyleAlert];
      const std::vector<std::string> labels = options.buttons.empty() ? std::vector<std::string>{"OK"} : options.buttons;
      for (size_t i = 0; i < labels.size(); i += 1) {
          const bool isCancel = labels.size() > 1 && i == labels.size() - 1;
          UIAlertAction *action = [UIAlertAction actionWithTitle:ns(labels[i])
                                                           style:isCancel ? UIAlertActionStyleCancel : UIAlertActionStyleDefault
                                                         handler:^(UIAlertAction *) { answer->give(static_cast<int>(i)); }];
          [alert addAction:action];
          if (i == 0) alert.preferredAction = action;
      }
      if (!presentOnTop(alert, window)) answer->give(NO_BUTTON);
    });
}

}  // namespace crossbind::dialog

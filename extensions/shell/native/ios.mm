// The shell on iOS, which opens addresses alone.
#import <UIKit/UIKit.h>

#include "shell.h"

#include <stdexcept>

namespace crossbind::shell {

void openUrl(std::string url, Done done) {
    onMainThread([url = std::move(url), done = std::move(done)] {
        NSURL *address = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()] ?: @""];
        if (!address) {
            done("crossbind: " + url + " is no address");
            return;
        }
        [UIApplication.sharedApplication openURL:address options:@{} completionHandler:^(BOOL opened) {
          done(opened ? std::optional<std::string>() : std::optional<std::string>("crossbind: nothing opens " + url));
        }];
    });
}

void openFile(std::string, Done) { throw std::runtime_error("crossbind: an iOS app opens no file in another app yet"); }

void revealFile(std::string, Done) { throw std::runtime_error("crossbind: an iOS app has no file manager to show a file in"); }

void trashFile(std::string, Done) { throw std::runtime_error("crossbind: an iOS app has no trash to move a file to"); }

}  // namespace crossbind::shell

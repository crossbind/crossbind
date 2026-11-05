// The shell on macOS, which the workspace and Finder answer.
#import <Cocoa/Cocoa.h>

#include "shell.h"

namespace crossbind::shell {
namespace {

using Failure = std::optional<std::string>;

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

bool exists(NSURL *file) { return [NSFileManager.defaultManager fileExistsAtPath:file.path]; }

}  // namespace

void openUrl(std::string url, Done done) {
    onMainThread([url = std::move(url), done = std::move(done)] {
        NSURL *address = [NSURL URLWithString:ns(url)];
        if (!address) {
            done("crossbind: " + url + " is no address");
            return;
        }
        done([NSWorkspace.sharedWorkspace openURL:address] ? Failure() : Failure("crossbind: nothing opens " + url));
    });
}

void openFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        NSURL *file = [NSURL fileURLWithPath:ns(path)];
        if (!exists(file)) {
            done("crossbind: there is no " + path);
            return;
        }
        done([NSWorkspace.sharedWorkspace openURL:file] ? Failure() : Failure("crossbind: nothing opens " + path));
    });
}

void revealFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        NSURL *file = [NSURL fileURLWithPath:ns(path)];
        if (!exists(file)) {
            done("crossbind: there is no " + path);
            return;
        }
        [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[ file ]];
        done(std::nullopt);
    });
}

// A volume without a trash fails it rather than deleting the file.
void trashFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        NSURL *file = [NSURL fileURLWithPath:ns(path)];
        if (!exists(file)) {
            done("crossbind: there is no " + path);
            return;
        }
        NSError *error = nil;
        if ([NSFileManager.defaultManager trashItemAtURL:file resultingItemURL:nil error:&error]) {
            done(std::nullopt);
        } else {
            NSString *why = error.localizedDescription;
            done("crossbind: cannot move " + path + " to the trash: " + std::string(why ? why.UTF8String : "macOS gave no reason"));
        }
    });
}

}  // namespace crossbind::shell

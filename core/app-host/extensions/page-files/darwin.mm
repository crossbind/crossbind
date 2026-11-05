#import <Cocoa/Cocoa.h>

#include "crossbind/extension.h"

#include <string>
#include <vector>

// The host's page-files on macOS: a file input's picker, as a sheet on the page's window, which takes folders where the
// input does. WKWebView tells none of the input's accept types.
void crossbind_extension_page_files(crossbind::Registry &registry) {
    registry.onFileInput([](crossbind::FileInput input) {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseFiles = YES;
        panel.canChooseDirectories = input.allowsFolders();
        panel.allowsMultipleSelection = input.allowsMultiple();
        void (^done)(NSModalResponse) = ^(NSModalResponse response) {
            if (response != NSModalResponseOK) {
                input.cancel();
                return;
            }
            std::vector<std::string> paths;
            for (NSURL *url in panel.URLs) paths.emplace_back(url.path.UTF8String ?: "");
            input.pick(paths);
        };
        const std::optional<crossbind::Window> open = crossbind::windowOf(input.page().windowId());
        NSWindow *window = (__bridge NSWindow *)(open ? open->native() : crossbind::appWindow());
        if (window) {
            [panel beginSheetModalForWindow:window completionHandler:done];
        } else {
            done([panel runModal]);
        }
    });
}

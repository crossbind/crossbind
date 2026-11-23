#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include "dialog.h"

namespace crossbind::dialog {
namespace {

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void onMain(void (^block)(void)) { dispatch_async(dispatch_get_main_queue(), block); }

// The panel shows every filter's files at once; none at all, or "*", lets it show any file.
NSArray<UTType *> *typesOf(const std::vector<FileFilter> &filters) {
    NSMutableArray<UTType *> *types = [NSMutableArray new];
    for (const auto &filter : filters) {
        for (const auto &extension : filter.extensions) {
            if (extension == "*") return @[];
            if (UTType *type = [UTType typeWithFilenameExtension:ns(extension)]) [types addObject:type];
        }
    }
    return types;
}

}  // namespace

// The panels are app-modal: nothing else in the app, quitting among it, happens while one asks.
void showOpenDialog(uint64_t, OpenOptions options, std::function<void(Picked)> done) {
    onMain(^{
      NSOpenPanel *panel = [NSOpenPanel openPanel];
      panel.canChooseFiles = !options.directory;
      panel.canChooseDirectories = options.directory;
      panel.allowsMultipleSelection = options.multiple;
      if (!options.title.empty()) panel.message = ns(options.title);
      if (!options.defaultPath.empty()) panel.directoryURL = [NSURL fileURLWithPath:ns(options.defaultPath)];
      panel.allowedContentTypes = typesOf(options.filters);
      if ([panel runModal] != NSModalResponseOK) {
          done(std::nullopt);
          return;
      }
      std::vector<std::string> paths;
      for (NSURL *url in panel.URLs) paths.push_back(url.path.UTF8String);
      done(paths);
    });
}

void showSaveDialog(uint64_t, SaveOptions options, std::function<void(std::optional<std::string>)> done) {
    onMain(^{
      NSSavePanel *panel = [NSSavePanel savePanel];
      if (!options.title.empty()) panel.message = ns(options.title);
      if (!options.defaultPath.empty()) panel.directoryURL = [NSURL fileURLWithPath:ns(options.defaultPath)];
      if (!options.defaultName.empty()) panel.nameFieldStringValue = ns(options.defaultName);
      panel.allowedContentTypes = typesOf(options.filters);
      if ([panel runModal] != NSModalResponseOK) {
          done(std::nullopt);
          return;
      }
      done(std::string(panel.URL.path.UTF8String));
    });
}

// App-modal, as the panels are, but for a project's page, whose dialog is a sheet of its window. Return clicks the first
// button and Escape the last of several, as closing the dialog does elsewhere; NSAlert would give Escape to one named
// Cancel instead, wherever it is.
void showMessageDialog(uint64_t window, MessageOptions options, std::function<void(int)> done) {
    onMain(^{
      NSAlert *alert = [NSAlert new];
      alert.messageText = ns(options.message);
      alert.informativeText = ns(options.detail);
      alert.alertStyle = options.kind == MessageKind::error     ? NSAlertStyleCritical
                         : options.kind == MessageKind::warning ? NSAlertStyleWarning
                                                                     : NSAlertStyleInformational;
      for (const auto &label : options.buttons) [alert addButtonWithTitle:ns(label)];
      NSString *escape = @"\x1b";
      for (NSButton *button in alert.buttons) {
          if ([button.keyEquivalent isEqualToString:escape]) button.keyEquivalent = @"";
      }
      alert.buttons.firstObject.keyEquivalent = @"\r";
      if (alert.buttons.count > 1) alert.buttons.lastObject.keyEquivalent = escape;
      const std::optional<Window> open = options.isAppModal ? std::nullopt : windowOf(window);
      __weak NSAlert *weakAlert = alert;
      if (open) {
          NSWindow *parent = (__bridge NSWindow *)open->native();
          __weak NSWindow *weakParent = parent;
          [alert beginSheetModalForWindow:parent completionHandler:^(NSModalResponse response) { done(static_cast<int>(response - NSAlertFirstButtonReturn)); }];
          if (options.closer) {
              // A sheet asked while another shows waits behind it among the window's sheets, which endSheet takes it from.
              options.closer->shown([weakParent, weakAlert] {
                  dispatch_async(dispatch_get_main_queue(), ^{
                    NSWindow *sheet = weakAlert.window;
                    if (sheet && [weakParent.sheets containsObject:sheet]) [weakParent endSheet:sheet returnCode:NSModalResponseAbort];
                  });
              });
          }
          return;
      }
      // The modal loop runs in a block of the main queue, which holds the queue's next ones: the close runs in the loop's
      // own mode.
      if (options.closer) {
          options.closer->shown([weakAlert] {
              CFRunLoopPerformBlock(CFRunLoopGetMain(), (__bridge CFArrayRef) @[ NSModalPanelRunLoopMode, NSDefaultRunLoopMode ], ^{
                if (weakAlert && NSApp.modalWindow == weakAlert.window) [NSApp abortModal];
              });
              CFRunLoopWakeUp(CFRunLoopGetMain());
          });
      }
      done(static_cast<int>([alert runModal] - NSAlertFirstButtonReturn));
    });
}

}  // namespace crossbind::dialog

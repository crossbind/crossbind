#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#endif

#include "platform.h"

#include <memory>
#include <stdexcept>

namespace {

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void onMain(void (^block)(void)) { dispatch_async(dispatch_get_main_queue(), block); }

// One of the user's folders, or a folder of the app's in it, made when missing.
std::string folder(NSSearchPathDirectory directory, NSString *child) {
    NSURL *url = [NSFileManager.defaultManager URLsForDirectory:directory inDomains:NSUserDomainMask].firstObject;
    if (child) url = [url URLByAppendingPathComponent:child isDirectory:YES];
    NSError *error = nil;
    if (!url || ![NSFileManager.defaultManager createDirectoryAtURL:url withIntermediateDirectories:YES attributes:nil error:&error]) {
        throw std::runtime_error(std::string("crossbind: cannot make the app's folder ") + (url.path.UTF8String ?: "") + ": " +
                                 (error.localizedDescription.UTF8String ?: "no such folder"));
    }
    return url.path.UTF8String;
}

}  // namespace

// Called on the module's thread, which has no autorelease pool of its own.
crossbind::app::Paths appPaths() {
    @autoreleasepool {
#if TARGET_OS_IPHONE
        // An iOS app's folders are its own already.
        return {folder(NSApplicationSupportDirectory, nil), folder(NSCachesDirectory, nil), folder(NSLibraryDirectory, @"Logs")};
#else
        NSString *id = NSBundle.mainBundle.bundleIdentifier ?: NSProcessInfo.processInfo.processName;
        return {folder(NSApplicationSupportDirectory, id), folder(NSCachesDirectory, id),
                folder(NSLibraryDirectory, [@"Logs/" stringByAppendingString:id])};
#endif
    }
}

void openUrl(std::string url, std::function<void(Failure)> done) {
    onMain(^{
      NSURL *address = [NSURL URLWithString:ns(url)];
      if (!address) {
          done("crossbind: " + url + " is no address");
          return;
      }
#if TARGET_OS_IPHONE
      [UIApplication.sharedApplication openURL:address options:@{} completionHandler:^(BOOL opened) {
        done(opened ? Failure() : Failure("crossbind: nothing opens " + url));
      }];
#else
      done([NSWorkspace.sharedWorkspace openURL:address] ? Failure() : Failure("crossbind: nothing opens " + url));
#endif
    });
}

#if TARGET_OS_IPHONE

void showOpenDialog(crossbind::app::OpenOptions, std::function<void(Picked)>) {
    throw std::runtime_error("crossbind: an iOS app has no file dialogs yet");
}

void showSaveDialog(crossbind::app::SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an iOS app has no file dialogs yet");
}

void openFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an iOS app opens no file in another app yet");
}

void revealFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an iOS app has no file manager to show a file in");
}

void trashFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an iOS app has no trash to move a file to");
}

void quitApp() { throw std::runtime_error("crossbind: an iOS app does not quit itself: the system ends it"); }

void setMenu(std::vector<MenuItem>, MenuClicked, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an iOS app has no menu bar");
}

namespace {

__weak UIWindow *mainWindow;

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

}  // namespace

// The last of several buttons is the one a keyboard's Escape clicks, which iOS places where its apps put Cancel.
void showMessageDialog(crossbind::app::MessageOptions options, std::function<void(int)> done) {
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
      if (!presentOnTop((__bridge void *)alert, (__bridge void *)mainWindow)) answer->give(NO_BUTTON);
    });
}

void setMainWindow(void *window) { mainWindow = (__bridge UIWindow *)window; }

#else

namespace {

// The panel shows every filter's files at once; none at all, or "*", lets it show any file.
NSArray<UTType *> *typesOf(const std::vector<crossbind::app::FileFilter> &filters) {
    NSMutableArray<UTType *> *types = [NSMutableArray new];
    for (const auto &filter : filters) {
        for (const auto &extension : filter.extensions) {
            if (extension == "*") return @[];
            if (UTType *type = [UTType typeWithFilenameExtension:ns(extension)]) [types addObject:type];
        }
    }
    return types;
}

bool exists(NSURL *file) { return [NSFileManager.defaultManager fileExistsAtPath:file.path]; }

}  // namespace

// The panels are app-modal: nothing else in the app, quitting among it, happens while one asks.
void showOpenDialog(crossbind::app::OpenOptions options, std::function<void(Picked)> done) {
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

void showSaveDialog(crossbind::app::SaveOptions options, std::function<void(std::optional<std::string>)> done) {
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

// App-modal, as the panels are. Return clicks the first button and Escape the last of several, as closing the dialog
// does elsewhere; NSAlert would give Escape to one named Cancel instead, wherever it is.
void showMessageDialog(crossbind::app::MessageOptions options, std::function<void(int)> done) {
    onMain(^{
      NSAlert *alert = [NSAlert new];
      alert.messageText = ns(options.message);
      alert.informativeText = ns(options.detail);
      alert.alertStyle = options.kind == crossbind::app::MessageKind::error     ? NSAlertStyleCritical
                         : options.kind == crossbind::app::MessageKind::warning ? NSAlertStyleWarning
                                                                                : NSAlertStyleInformational;
      for (const auto &label : options.buttons) [alert addButtonWithTitle:ns(label)];
      NSString *escape = @"\x1b";
      for (NSButton *button in alert.buttons) {
          if ([button.keyEquivalent isEqualToString:escape]) button.keyEquivalent = @"";
      }
      alert.buttons.firstObject.keyEquivalent = @"\r";
      if (alert.buttons.count > 1) alert.buttons.lastObject.keyEquivalent = escape;
      done(static_cast<int>([alert runModal] - NSAlertFirstButtonReturn));
    });
}

void openFile(std::string path, std::function<void(Failure)> done) {
    onMain(^{
      NSURL *file = [NSURL fileURLWithPath:ns(path)];
      if (!exists(file)) {
          done("crossbind: there is no " + path);
          return;
      }
      done([NSWorkspace.sharedWorkspace openURL:file] ? Failure() : Failure("crossbind: nothing opens " + path));
    });
}

void revealFile(std::string path, std::function<void(Failure)> done) {
    onMain(^{
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
void trashFile(std::string path, std::function<void(Failure)> done) {
    onMain(^{
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

void quitApp() {
    onMain(^{
      [NSApp terminate:nil];
    });
}

namespace {
__weak NSWindow *mainWindow;
}  // namespace

// A panel asks for its app, not a window of it; showWindow needs the window. The window fills the screen whatever
// app.window's limits, which it holds to again after: AppKit keeps a window that does not resize, or one with a
// maximum, to its size there.
void setMainWindow(void *window) {
    mainWindow = (__bridge NSWindow *)window;
    const NSSize most = mainWindow.contentMaxSize;
    const NSWindowStyleMask style = mainWindow.styleMask;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:NSWindowWillEnterFullScreenNotification object:mainWindow queue:nil usingBlock:^(NSNotification *note) {
        NSWindow *filling = note.object;
        filling.styleMask |= NSWindowStyleMaskResizable;
        filling.contentMaxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
    }];
    [center addObserverForName:NSWindowDidExitFullScreenNotification object:mainWindow queue:nil usingBlock:^(NSNotification *note) {
        NSWindow *windowed = note.object;
        windowed.styleMask = style;
        windowed.contentMaxSize = most;
    }];
}

void showWindow(const std::string &) {
    onMain(^{
      if (mainWindow.miniaturized) [mainWindow deminiaturize:nil];
      [mainWindow makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
    });
}

void setBackgroundColor(void *window, void *webView, std::uint32_t color) {
    ((__bridge NSWindow *)window).backgroundColor = [NSColor colorWithSRGBRed:((color >> 16) & 0xff) / 255.0
                                                                         green:((color >> 8) & 0xff) / 255.0
                                                                          blue:(color & 0xff) / 255.0
                                                                         alpha:1];
    // Without this, WKWebView draws white of its own until the page paints, and behind it. The setter is WebKit's own,
    // which a later macOS may take away.
    id view = (__bridge id)webView;
    if ([view respondsToSelector:NSSelectorFromString(@"_setDrawsBackground:")]) [view setValue:@NO forKey:@"drawsBackground"];
}

// macOS takes the window full screen, into a Space of its own, once the app runs.
void fillScreen() {
    onMain(^{
      // A window that does not resize goes full screen only when it says it can.
      mainWindow.collectionBehavior |= NSWindowCollectionBehaviorFullScreenPrimary;
      [mainWindow toggleFullScreen:nil];
    });
}

#endif

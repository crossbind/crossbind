#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#import <UserNotifications/UserNotifications.h>
#endif

#include "host_core.h"
#include "platform.h"

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

void crossbind::onMainThread(std::function<void()> fn) { onMain(^{ fn(); }); }

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

void setTray(TrayOptions, MenuClicked, std::function<void(Failure)>) { throw std::runtime_error("crossbind: an iOS app has no tray icon"); }

void removeTray(std::function<void(Failure)>) { throw std::runtime_error("crossbind: an iOS app has no tray icon"); }

void showNotification(Notification, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an iOS app shows no notifications yet");
}

namespace {
__weak UIWindow *mainWindow;
}  // namespace

void setMainWindow(void *window) { mainWindow = (__bridge UIWindow *)window; }

void *crossbind::appWindow() { return (__bridge void *)mainWindow; }

#else

namespace {

bool exists(NSURL *file) { return [NSFileManager.defaultManager fileExistsAtPath:file.path]; }

}  // namespace

// Shows the app's notifications while it is in front, as macOS does only when asked, and tells the page of a click on
// one.
@interface CrossbindNotifications : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation CrossbindNotifications

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) crossbind::app::postEvent("notification", "null");
    completionHandler();
}

@end

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

void *crossbind::appWindow() { return (__bridge void *)mainWindow; }

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

// macOS asks its user the first time, and has no notifications for an executable outside a bundle, as a development
// session may run.
void showNotification(Notification notification, std::function<void(Failure)> done) {
    onMain(^{
      if (!NSBundle.mainBundle.bundleIdentifier) {
          done("crossbind: a macOS app shows notifications from its bundle alone");
          return;
      }
      static CrossbindNotifications *delegate = [CrossbindNotifications new];
      UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
      center.delegate = delegate;
      UNMutableNotificationContent *content = [UNMutableNotificationContent new];
      content.title = ns(notification.title);
      content.body = ns(notification.body);
      content.sound = UNNotificationSound.defaultSound;
      [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                            completionHandler:^(BOOL isAllowed, NSError *refused) {
                              if (!isAllowed) {
                                  const std::string why = refused ? refused.localizedDescription.UTF8String : "its user turned them off";
                                  onMain(^{
                                    done("crossbind: macOS does not let the app show notifications: " + why);
                                  });
                                  return;
                              }
                              UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:NSUUID.UUID.UUIDString
                                                                                                    content:content
                                                                                                    trigger:nil];
                              [center addNotificationRequest:request withCompletionHandler:^(NSError *failed) {
                                const Failure failure = failed ? Failure(std::string("crossbind: macOS did not show the notification: ") +
                                                                         failed.localizedDescription.UTF8String)
                                                               : Failure();
                                onMain(^{
                                  done(failure);
                                });
                              }];
                            }];
    });
}

#endif

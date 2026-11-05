#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#endif

#include "host_core.h"
#include "platform.h"
#include "values.h"

#include <atomic>
#include <cstdio>
#include <stdexcept>

namespace {

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

void crossbind::onMainThread(std::function<void()> fn) { onMain(^{ runTask(fn); }); }

bool isMainThread() { return NSThread.isMainThread; }

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

#if TARGET_OS_IPHONE

void quitApp() { throw std::runtime_error("crossbind: an iOS app does not quit itself: the system ends it"); }

namespace {
__weak UIWindow *mainWindow;
__weak id mainWebView;
}  // namespace

void setMainWindow(void *window, void *webView) {
    mainWindow = (__bridge UIWindow *)window;
    mainWebView = (__bridge id)webView;
    // The app comes to the foreground and leaves it, which every scene's window shares.
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
      [center addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:nil usingBlock:^(NSNotification *) {
          crossbind::app::appActivated(true);
      }];
      [center addObserverForName:UIApplicationWillResignActiveNotification object:nil queue:nil usingBlock:^(NSNotification *) {
          crossbind::app::appActivated(false);
      }];
    });
}

void *crossbind::appWindow() { return (__bridge void *)mainWindow; }

void *crossbind::appWebView() { return (__bridge void *)mainWebView; }

#else

namespace {
// The app's own quit, app.quit()'s, which asks none of its extensions.
std::atomic<bool> isQuittingByApp{false};
}  // namespace

void quitApp() {
    onMain(^{
      isQuittingByApp = true;
      [NSApp terminate:nil];
    });
}

void terminateApp() {
    onMain(^{
      [NSApp terminate:nil];
    });
}

namespace {
__weak NSWindow *mainWindow;
__weak id mainWebView;

// What the app's delegate, webview's, answers of a question AppKit asks the app, which AppKit learns as the delegate is
// set.
void answerApp(SEL selector, id block) {
    id delegate = NSApp.delegate;
    if (!delegate) return;
    if ([delegate respondsToSelector:selector]) {
        std::fprintf(stderr, "crossbind: the app's delegate answers %s itself, which the app's extensions then hear nothing of\n", sel_getName(selector));
        return;
    }
    const char *types = protocol_getMethodDescription(@protocol(NSApplicationDelegate), selector, NO, YES).types;
    class_addMethod([delegate class], selector, imp_implementationWithBlock(block), types);
}
}  // namespace

void answerLaunches() {
    // A user activity reaches the owner of its type, and macOS tells its user it could not continue one that none took.
    answerApp(@selector(application:continueUserActivity:restorationHandler:), ^BOOL(id, NSApplication *, NSUserActivity *activity, id) {
        return continueActivity((__bridge void *)activity);
    });
    // The app's push token, which an extension asked for with registerForPush(), why macOS gave none, and each silent
    // push reach every extension; macOS takes no answer of a push.
    answerApp(@selector(application:didRegisterForRemoteNotificationsWithDeviceToken:), ^(id, NSApplication *, NSData *token) {
        crossbind::app::pushTokenArrived(hexOf(token));
    });
    answerApp(@selector(application:didFailToRegisterForRemoteNotificationsWithError:), ^(id, NSApplication *, NSError *error) {
        crossbind::app::pushTokenFailed(textOf(error.localizedDescription));
    });
    answerApp(@selector(application:didReceiveRemoteNotification:), ^(id, NSApplication *, NSDictionary *payload) {
        crossbind::app::pushArrived(valueOfPlist(payload), nullptr);
    });
    id appDelegate = NSApp.delegate;
    NSApp.delegate = nil;
    NSApp.delegate = appDelegate;
}

// A panel asks for its app, not a window of it; showWindow needs the window. The window fills the screen whatever
// app.window's limits, which it holds to again after: AppKit keeps a window that does not resize, or one with a
// maximum, to its size there.
void setMainWindow(void *window, void *webView) {
    mainWindow = (__bridge NSWindow *)window;
    mainWebView = (__bridge id)webView;
    // The window asks the app's extensions as its user closes it; app.quit() terminates the app without asking. Its
    // delegate, webview's, has no windowShouldClose: of its own, and AppKit learns what a delegate answers as it is set.
    id delegate = mainWindow.delegate;
    if (delegate && ![delegate respondsToSelector:@selector(windowShouldClose:)]) {
        const char *types = protocol_getMethodDescription(@protocol(NSWindowDelegate), @selector(windowShouldClose:), NO, YES).types;
        class_addMethod([delegate class], @selector(windowShouldClose:), imp_implementationWithBlock(^BOOL(id, NSWindow *) {
            return crossbind::app::isCloseAllowed();
        }), types);
        mainWindow.delegate = nil;
        mainWindow.delegate = delegate;
    }
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
    [center addObserverForName:NSApplicationDidBecomeActiveNotification object:NSApp queue:nil usingBlock:^(NSNotification *) {
        crossbind::app::appActivated(true);
    }];
    [center addObserverForName:NSApplicationDidResignActiveNotification object:NSApp queue:nil usingBlock:^(NSNotification *) {
        crossbind::app::appActivated(false);
    }];
    // The app's Quit asks its extensions, which app.quit() does not; a click of the Dock icon shows the window again, as
    // one an app in its tray hid.
    answerApp(@selector(applicationShouldTerminate:), ^NSApplicationTerminateReply(id, NSApplication *) {
        return isQuittingByApp || crossbind::app::isQuitAllowed() ? NSTerminateNow : NSTerminateCancel;
    });
    answerApp(@selector(applicationShouldHandleReopen:hasVisibleWindows:), ^BOOL(id, NSApplication *, BOOL) {
        if (mainWindow.miniaturized) [mainWindow deminiaturize:nil];
        [mainWindow makeKeyAndOrderFront:nil];
        crossbind::app::reopened();
        return NO;
    });
    id appDelegate = NSApp.delegate;
    NSApp.delegate = nil;
    NSApp.delegate = appDelegate;
    // The app may have become active as it launched, before the window opened: the extensions hear how it is once the
    // window has.
    onMain(^{
      crossbind::app::appActivated(NSApp.active);
    });
}

void *crossbind::appWindow() { return (__bridge void *)mainWindow; }

void *crossbind::appWebView() { return (__bridge void *)mainWebView; }

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

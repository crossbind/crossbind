#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#endif

// The App Group of the app's, which crossbind writes into the build directory from its extensions' targets.
#include "crossbind_app.h"
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

// Called on the module's thread, which has no autorelease pool of its own.
crossbind::app::Paths appPaths() {
    @autoreleasepool {
#if TARGET_OS_IPHONE
        // An iOS app's folders are its own already, and iOS keeps the one of its App Group.
        crossbind::app::Paths folders{folder(NSApplicationSupportDirectory, nil), folder(NSCachesDirectory, nil), folder(NSLibraryDirectory, @"Logs")};
#ifdef CROSSBIND_APP_GROUP
        folders.group = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:@CROSSBIND_APP_GROUP].path.UTF8String ?: "";
#endif
        return folders;
#else
        NSString *id = NSBundle.mainBundle.bundleIdentifier ?: NSProcessInfo.processInfo.processName;
        return {folder(NSApplicationSupportDirectory, id), folder(NSCachesDirectory, id),
                folder(NSLibraryDirectory, [@"Logs/" stringByAppendingString:id])};
#endif
    }
}

// An iPad a tablet, and an iPhone or iPad app that runs on a Mac a desktop.
System appSystem() {
#if TARGET_OS_IPHONE
    UIDevice *device = UIDevice.currentDevice;
    const char *form = NSProcessInfo.processInfo.isiOSAppOnMac ? "desktop" : device.userInterfaceIdiom == UIUserInterfaceIdiomPad ? "tablet" : "phone";
    return {form, device.systemName.UTF8String ?: "iOS", device.systemVersion.UTF8String ?: "", TARGET_OS_SIMULATOR != 0};
#else
    const NSOperatingSystemVersion version = NSProcessInfo.processInfo.operatingSystemVersion;
    std::string text = std::to_string(version.majorVersion) + "." + std::to_string(version.minorVersion);
    if (version.patchVersion != 0) text += "." + std::to_string(version.patchVersion);
    return {"desktop", "macOS", text, false};
#endif
}

#if TARGET_OS_IPHONE

void quitApp() { throw std::runtime_error("crossbind: an iOS app does not quit itself: the system ends it"); }

// The app comes to the foreground and leaves it, which every scene's window shares.
void listenForActivity() {
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
// What the app's delegate, the host's, answers of a question AppKit asks the app, which AppKit learns as the delegate is
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

void watchApp() {
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:NSApplicationDidBecomeActiveNotification object:NSApp queue:nil usingBlock:^(NSNotification *) {
        crossbind::app::appActivated(true);
    }];
    [center addObserverForName:NSApplicationDidResignActiveNotification object:NSApp queue:nil usingBlock:^(NSNotification *) {
        crossbind::app::appActivated(false);
    }];
    // The app's Quit asks its extensions, which app.quit() does not; a click of the Dock icon shows the windows again, as
    // those an app in its tray hid.
    answerApp(@selector(applicationShouldTerminate:), ^NSApplicationTerminateReply(id, NSApplication *) {
        return isQuittingByApp || crossbind::app::isQuitAllowed() ? NSTerminateNow : NSTerminateCancel;
    });
    answerApp(@selector(applicationShouldHandleReopen:hasVisibleWindows:), ^BOOL(id, NSApplication *, BOOL) {
        showHiddenWindows();
        if (const std::optional<crossbind::Window> front = crossbind::windowOf(crossbind::app::frontWindow())) {
            [(__bridge NSWindow *)front->native() makeKeyAndOrderFront:nil];
        }
        crossbind::app::reopened();
        return NO;
    });
    id appDelegate = NSApp.delegate;
    NSApp.delegate = nil;
    NSApp.delegate = appDelegate;
    // The app may have become active as it launched, before its first window opened: the extensions hear how it is once
    // the loop runs.
    onMain(^{
      crossbind::app::appActivated(NSApp.active);
    });
}

void showWindow(const std::string &) {
    onMain(^{
      if (const std::optional<crossbind::Window> front = crossbind::windowOf(crossbind::app::frontWindow())) {
          NSWindow *window = (__bridge NSWindow *)front->native();
          if (window.miniaturized) [window deminiaturize:nil];
          [window makeKeyAndOrderFront:nil];
      }
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

#endif

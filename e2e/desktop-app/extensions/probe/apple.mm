// What the probe adds on Apple's platforms: the Info.plist key its descriptor gives and an iOS app's privacy reasons, as
// the app's bundle holds them, what its Swift gives, the app's activation, as the system tells it, and on macOS a close of
// the window, as its user's, and the app's reopening.
#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

#include "crossbind/app.h"
#include "probe.h"
// The header swiftc makes of the probe's Swift: its @_cdecl function and its @objc class.
#import "probe-Swift.h"

void tellActive(bool isActive) {
#if TARGET_OS_IPHONE
    NSNotificationName name = isActive ? UIApplicationDidBecomeActiveNotification : UIApplicationWillResignActiveNotification;
    [NSNotificationCenter.defaultCenter postNotificationName:name object:UIApplication.sharedApplication];
#else
    NSNotificationName name = isActive ? NSApplicationDidBecomeActiveNotification : NSApplicationDidResignActiveNotification;
    [NSNotificationCenter.defaultCenter postNotificationName:name object:NSApp];
#endif
}

void probePlatform(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.function("probe.apple", [](Call call) {
        NSString *plist = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CrossbindProbe"];
        // A property list, which the bundle may hold in its binary form.
        NSString *manifest = [NSBundle.mainBundle pathForResource:@"PrivacyInfo" ofType:@"xcprivacy"];
        NSDictionary *privacy = manifest ? [NSDictionary dictionaryWithContentsOfFile:manifest] : nil;
        bool hasReason = false;
        for (NSDictionary *type in privacy[@"NSPrivacyAccessedAPITypes"]) {
            hasReason = hasReason || ([type[@"NSPrivacyAccessedAPIType"] isEqual:@"NSPrivacyAccessedAPICategoryUserDefaults"] &&
                                      [type[@"NSPrivacyAccessedAPITypeReasons"] containsObject:@"CA92.1"]);
        }
        call.resolve(Value::Object{{"plist", plist ? Value(plist.UTF8String) : Value()}, {"privacy", hasReason}, {"swift", probe_swift_sum(2, 3)},
                                   {"swiftClass", [[ProbeSwift new] greeting].UTF8String}});
    });
#if !TARGET_OS_IPHONE
    registry.function("probe.close", [](Call call) {
        crossbind::onMainThread([call] {
            [(__bridge NSWindow *)crossbind::appWindow() performClose:nil];
            call.resolve();
        });
    });
    // The window hidden, as an app in its tray hides it, which the app shows again before the probe hears it reopen.
    registry.function("probe.hide", [](Call call) {
        crossbind::onMainThread([call] {
            [(__bridge NSWindow *)crossbind::appWindow() orderOut:nil];
            call.resolve();
        });
    });
    registry.onReopen([] {
        const bool isShown = ((__bridge NSWindow *)crossbind::appWindow()).visible;
        crossbind::app::emitEvent("probe-reopen", Value(Value::Object{{"isShown", isShown}}).json());
    });
#endif
}

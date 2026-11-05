// What the probe adds on Apple's platforms: the Info.plist key its descriptor gives and an iOS app's privacy reasons, as
// the app's bundle holds them, and on macOS a close of the window, as its user's.
#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#if !TARGET_OS_IPHONE
#import <AppKit/AppKit.h>
#endif

#include "probe.h"

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
        call.resolve(Value::Object{{"plist", plist ? Value(plist.UTF8String) : Value()}, {"privacy", hasReason}});
    });
#if !TARGET_OS_IPHONE
    registry.function("probe.close", [](Call call) {
        crossbind::onMainThread([call] {
            [(__bridge NSWindow *)crossbind::appWindow() performClose:nil];
            call.resolve();
        });
    });
#endif
}

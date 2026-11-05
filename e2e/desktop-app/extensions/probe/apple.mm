// What the probe adds on Apple's platforms: the Info.plist key its descriptor gives and an iOS app's privacy reasons, as
// the app's bundle holds them, what its Swift gives, the app's activation, as the system tells it, the user activities
// the app continues, the host's notification center and push, and on macOS a close of the window, as its user's, and
// the app's reopening.
#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/message.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

#include "crossbind/app.h"
#include "probe.h"

#include <cstdint>
#include <stdexcept>
// The header swiftc makes of the probe's Swift: its @_cdecl function and its @objc class.
#import "probe-Swift.h"

namespace {

using crossbind::Value;

// A notification of this identifier, which UserNotifications makes outside a delivery through its private initializer
// alone, as a test may: the probe's own fails where a later system has none.
UNNotification *notificationOf(NSString *identifier) {
    SEL make = NSSelectorFromString(@"notificationWithRequest:date:");
    if (![UNNotification respondsToSelector:make]) throw std::runtime_error("UserNotifications has no notificationWithRequest:date: to make a notification with");
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = @"Probe";
    content.userInfo = @{@"probe" : @YES};
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
    return reinterpret_cast<UNNotification *(*)(id, SEL, UNNotificationRequest *, NSDate *)>(objc_msgSend)(UNNotification.class, make, request, NSDate.date);
}

UNNotificationResponse *responseOf(UNNotification *notification, NSString *action) {
    SEL make = NSSelectorFromString(@"responseWithNotification:actionIdentifier:");
    if (![UNNotificationResponse respondsToSelector:make]) throw std::runtime_error("UserNotifications has no responseWithNotification:actionIdentifier: to make an answer with");
    return reinterpret_cast<UNNotificationResponse *(*)(id, SEL, UNNotification *, NSString *)>(objc_msgSend)(UNNotificationResponse.class, make, notification, action);
}

Value presentationOf(UNNotificationPresentationOptions options) {
    return Value(Value::Object{{"banner", (options & UNNotificationPresentationOptionBanner) != 0}, {"list", (options & UNNotificationPresentationOptionList) != 0},
                               {"sound", (options & UNNotificationPresentationOptionSound) != 0}, {"badge", (options & UNNotificationPresentationOptionBadge) != 0}});
}

}  // namespace

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
        Value::Array activityTypes;
        for (NSString *type in [NSBundle.mainBundle objectForInfoDictionaryKey:@"NSUserActivityTypes"]) activityTypes.emplace_back(type.UTF8String);
        Value::Array shortcutTypes;
        for (NSDictionary *item in [NSBundle.mainBundle objectForInfoDictionaryKey:@"UIApplicationShortcutItems"]) {
            shortcutTypes.emplace_back([item[@"UIApplicationShortcutItemType"] UTF8String]);
        }
        call.resolve(Value::Object{{"plist", plist ? Value(plist.UTF8String) : Value()}, {"privacy", hasReason}, {"swift", probe_swift_sum(2, 3)},
                                   {"swiftClass", [[ProbeSwift new] greeting].UTF8String}, {"activityTypes", std::move(activityTypes)},
                                   {"shortcutTypes", std::move(shortcutTypes)}});
    });
    // Each notification the host's center hears of, of which the probe shows its own in the list alone while the app is in
    // front, and the class that owns the center.
    registry.onNotification([events = registry.events()](const crossbind::Notification &notification) {
        if (notification.id().rfind("probe.", 0) == 0) notification.present({false, true, false, false});
        events.emit("notification", Value::Object{{"id", notification.id()}, {"isAnswered", notification.isAnswered()}, {"isTap", notification.isTap()},
                                        {"isDismissed", notification.isDismissed()}, {"action", notification.action()}, {"isRemote", notification.isRemote()},
                                        {"probe", notification.payload()["probe"]}});
    });
    registry.function("probe.notificationCenter", [](Call call) {
        crossbind::onMainThread([call] {
            id owner = UNUserNotificationCenter.currentNotificationCenter.delegate;
            call.resolve(owner ? Value(NSStringFromClass([owner class]).UTF8String) : Value());
        });
    });
    // Hands the center's owner a notification of this identifier, as the system does: one to show while the app is in
    // front, whose presentation it answers, or one its user answered by a tap or an action.
    registry.function("probe.notify", [](Call call) {
        crossbind::onMainThread([call] {
            id<UNUserNotificationCenterDelegate> owner = UNUserNotificationCenter.currentNotificationCenter.delegate;
            UNNotification *notification = notificationOf(@(call.options()["id"].asString().c_str()));
            const std::string answer = call.options()["answer"].asString("");
            if (answer.empty()) {
                [owner userNotificationCenter:UNUserNotificationCenter.currentNotificationCenter willPresentNotification:notification
                        withCompletionHandler:^(UNNotificationPresentationOptions options) { call.resolve(presentationOf(options)); }];
                return;
            }
            NSString *action = answer == "tap" ? UNNotificationDefaultActionIdentifier : @(answer.c_str());
            [owner userNotificationCenter:UNUserNotificationCenter.currentNotificationCenter didReceiveNotificationResponse:responseOf(notification, action)
                    withCompletionHandler:^{ call.resolve(); }];
        });
    });
    // The app's push token, or why the system gave none, and a silent push of the probe's, which it fetched for.
    registry.onPushToken([events = registry.events()](const crossbind::PushToken &token) { events.emit("push", Value::Object{{"token", token.token}}); });
    registry.onPushTokenFailure(
        [events = registry.events()](const crossbind::PushTokenFailure &failure) { events.emit("push", Value::Object{{"failure", failure.message}}); });
    registry.onPushMessage([events = registry.events()](const Value &payload, crossbind::PushDone done) {
        events.emit("push-message", payload);
        if (payload["probe"].asBool(false)) done.newData();
    });
    registry.function("probe.registerForPush", [](Call call) {
        crossbind::registerForPush();
        call.resolve();
    });
    // Hands the app's delegate a silent push, as the system does: what the extensions answered, as iOS hears it.
    registry.function("probe.silentPush", [](Call call) {
        crossbind::onMainThread([call] {
            NSDictionary *payload = @{@"aps" : @{@"content-available" : @1}, @"probe" : @YES};
#if TARGET_OS_IPHONE
            id<UIApplicationDelegate> delegate = UIApplication.sharedApplication.delegate;
            [delegate application:UIApplication.sharedApplication didReceiveRemoteNotification:payload fetchCompletionHandler:^(UIBackgroundFetchResult result) {
                call.resolve(result == UIBackgroundFetchResultNewData ? "newData" : result == UIBackgroundFetchResultFailed ? "failed" : "noData");
            }];
#else
            id<NSApplicationDelegate> delegate = NSApp.delegate;
            if (![delegate respondsToSelector:@selector(application:didReceiveRemoteNotification:)]) throw std::runtime_error("the app's delegate takes no push");
            [delegate application:NSApp didReceiveRemoteNotification:payload];
            call.resolve();
#endif
        });
    });
    // A user activity of the probe's own type, its bytes as numbers.
    registry.onUserActivity([events = registry.events()](const crossbind::UserActivity &activity) {
        Value::Array data;
        for (const std::uint8_t byte : activity.userInfo["data"].asBytes()) data.emplace_back(static_cast<int>(byte));
        events.emit("activity", Value::Object{{"type", activity.type}, {"text", activity.userInfo["text"]}, {"data", std::move(data)}, {"webpageUrl", activity.webpageUrl}});
        return true;
    });
    // Hands the app's delegate a user activity of this type, as Handoff does, with a userInfo of each kind a property list
    // holds, bytes as well where asked: whether a macOS delegate took it.
    registry.function("probe.continueActivity", [](Call call) {
        crossbind::onMainThread([call] {
            NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:@(call.options()["type"].asString().c_str())];
            NSMutableDictionary *info = [@{
                @"n" : @1, @"flag" : @YES, @"text" : @"a", @"list" : @[ @1, NSNull.null ], @"nested" : @{@"x" : @"y"},
                @"date" : [NSDate dateWithTimeIntervalSince1970:0], @"url" : [NSURL URLWithString:@"https://example.com/x"],
                @"uuid" : [[NSUUID alloc] initWithUUIDString:@"E621E1F8-C36C-495A-93FC-0C247A3E6E5F"], @"set" : [NSSet setWithObject:@"s"],
            } mutableCopy];
            if (call.options()["withData"].asBool(false)) info[@"data"] = [NSData dataWithBytes:"\x01\x02\x03" length:3];
            activity.userInfo = info;
            activity.webpageURL = [NSURL URLWithString:@"https://example.com/page"];
#if TARGET_OS_IPHONE
            UIScene *scene = UIApplication.sharedApplication.connectedScenes.anyObject;
            id<UISceneDelegate> delegate = scene.delegate;
            if (![delegate respondsToSelector:@selector(scene:continueUserActivity:)]) throw std::runtime_error("the scene's delegate continues no user activity");
            [delegate scene:scene continueUserActivity:activity];
            call.resolve();
#else
            id<NSApplicationDelegate> delegate = NSApp.delegate;
            if (![delegate respondsToSelector:@selector(application:continueUserActivity:restorationHandler:)]) throw std::runtime_error("the app's delegate continues no user activity");
            // BOOL is a signed char on an Intel Mac, which would be a number.
            call.resolve(static_cast<bool>([delegate application:NSApp continueUserActivity:activity restorationHandler:^(NSArray *) {}]));
#endif
        });
    });
#if TARGET_OS_IPHONE
    // A tap of a quick action of the app's icon while it runs, as iOS hands the scene's delegate one: whether an owner
    // took it.
    registry.function("probe.tapShortcut", [](Call call) {
        crossbind::onMainThread([call] {
            UIWindowScene *scene = (UIWindowScene *)UIApplication.sharedApplication.connectedScenes.anyObject;
            id<UIWindowSceneDelegate> delegate = (id<UIWindowSceneDelegate>)scene.delegate;
            if (![delegate respondsToSelector:@selector(windowScene:performActionForShortcutItem:completionHandler:)]) {
                throw std::runtime_error("the scene's delegate takes no quick action");
            }
            UIApplicationShortcutItem *item = [[UIApplicationShortcutItem alloc] initWithType:@(call.options()["type"].asString().c_str()) localizedTitle:@"Probe"];
            [delegate windowScene:scene performActionForShortcutItem:item completionHandler:^(BOOL isTaken) { call.resolve(static_cast<bool>(isTaken)); }];
        });
    });
#else
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
    registry.onReopen([events = registry.events()] {
        const bool isShown = ((__bridge NSWindow *)crossbind::appWindow()).visible;
        events.emit("reopen", Value::Object{{"isShown", isShown}});
    });
    // The titles of the menu the app's delegate gives the Dock, as the Dock asks for it.
    registry.function("probe.dockMenu", [](Call call) {
        crossbind::onMainThread([call] {
            id<NSApplicationDelegate> delegate = NSApp.delegate;
            NSMenu *menu = [delegate respondsToSelector:@selector(applicationDockMenu:)] ? [delegate applicationDockMenu:NSApp] : nil;
            Value::Array titles;
            for (NSMenuItem *item in menu.itemArray) titles.emplace_back(item.title.UTF8String);
            call.resolve(Value(std::move(titles)));
        });
    });
#endif
}

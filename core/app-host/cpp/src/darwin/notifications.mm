// The host's own notification center on iOS and macOS, which it takes as the app launches, before the tap that launched
// it comes: each extension hears of each notification the system shows while the app is in front, and of each its user
// answers; and the push token the app asks for.
#import <TargetConditionals.h>
#import <UserNotifications/UserNotifications.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

#include "host_core.h"
#include "platform.h"
#include "values.h"

#include <cstdio>

@interface CrossbindNotificationCenter : NSObject <UNUserNotificationCenterDelegate>
@end

namespace {

std::shared_ptr<crossbind::app::StateOf<crossbind::Notification>> stateOf(UNNotification *notification) {
    auto state = std::make_shared<crossbind::app::StateOf<crossbind::Notification>>();
    UNNotificationRequest *request = notification.request;
    state->id = textOf(request.identifier);
    state->title = textOf(request.content.title);
    state->body = textOf(request.content.body);
    state->payload = valueOfPlist(request.content.userInfo ?: @{});
    state->isRemote = [request.trigger isKindOfClass:UNPushNotificationTrigger.class];
    return state;
}

UNNotificationPresentationOptions optionsOf(const crossbind::NotificationPresentation &presentation) {
    UNNotificationPresentationOptions options = 0;
    if (presentation.banner) options |= UNNotificationPresentationOptionBanner;
    if (presentation.list) options |= UNNotificationPresentationOptionList;
    if (presentation.sound) options |= UNNotificationPresentationOptionSound;
    if (presentation.badge) options |= UNNotificationPresentationOptionBadge;
    return options;
}

}  // namespace

// UserNotifications calls its delegate on a queue of its own, which no thread is promised: the extensions hear of each
// notification on the main thread.
@implementation CrossbindNotificationCenter

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
    const auto state = stateOf(notification);
    dispatch_async(dispatch_get_main_queue(), ^{
      done(optionsOf(crossbind::app::notified(state)));
    });
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))done {
    const auto state = stateOf(response.notification);
    state->isAnswered = true;
    state->isTap = [response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier];
    state->isDismissed = [response.actionIdentifier isEqualToString:UNNotificationDismissActionIdentifier];
    if (!state->isTap && !state->isDismissed) state->action = textOf(response.actionIdentifier);
    dispatch_async(dispatch_get_main_queue(), ^{
      crossbind::app::notified(state);
      done();
    });
}

@end

void ownNotificationCenter() {
    // An executable outside a bundle, as a macOS development session may run, has no notification center.
    if (!NSBundle.mainBundle.bundleIdentifier) return;
    static CrossbindNotificationCenter *owner = [CrossbindNotificationCenter new];
    UNUserNotificationCenter.currentNotificationCenter.delegate = owner;
}

void crossbind::addNotificationCategories(void *categories) {
    NSSet *added = [(__bridge NSSet *)categories copy];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!NSBundle.mainBundle.bundleIdentifier) return;
      // Every extension's, by their identifiers.
      static NSMutableDictionary<NSString *, UNNotificationCategory *> *all = [NSMutableDictionary dictionary];
      for (id category in added) {
          if ([category isKindOfClass:UNNotificationCategory.class]) {
              all[((UNNotificationCategory *)category).identifier] = category;
          } else {
              std::fprintf(stderr, "crossbind: addNotificationCategories() takes UNNotificationCategory alone, and left out a %s\n",
                  NSStringFromClass([category class]).UTF8String);
          }
      }
      [UNUserNotificationCenter.currentNotificationCenter setNotificationCategories:[NSSet setWithArray:all.allValues]];
    });
}

void crossbind::registerForPush() {
    dispatch_async(dispatch_get_main_queue(), ^{
#if TARGET_OS_IPHONE
      [UIApplication.sharedApplication registerForRemoteNotifications];
#else
      [NSApp registerForRemoteNotifications];
#endif
    });
}

// iOS hands a running app a link of a site its association names as a user activity of the web: the hook hands the
// scene's delegate one, as iOS does, where xcrun simctl openurl stops at SpringBoard's question to its user. And the
// alert up, as its user reads it, and its button pressed: the run's way to the preview extension's question on iOS,
// where no public way presses an alert's button and an alert's views are no elements of accessibility until an
// assistive technology runs. The press dismisses the alert, then runs the action's own handler, as a tap on it does,
// through UIAlertAction's handler key, which the fixture alone reads.
#include "crossbind/extension.h"

#import <UIKit/UIKit.h>

namespace {

using crossbind::Call;
using crossbind::Value;

UIAlertController *alertUp() {
    UIViewController *top = ((__bridge UIWindow *)crossbind::appWindow()).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    return [top isKindOfClass:UIAlertController.class] ? (UIAlertController *)top : nil;
}

std::string textOf(NSString *text) { return text.UTF8String ?: ""; }

}  // namespace

// What the alert up shows, or null: its title and message, its actions and the one Return presses.
void questionUp(Call call) {
    crossbind::onMainThread([call] {
        UIAlertController *alert = alertUp();
        if (!alert) {
            call.resolve();
            return;
        }
        Value::Array titles;
        for (UIAlertAction *action in alert.actions) titles.emplace_back(textOf(action.title));
        const Value preferred = alert.preferredAction ? Value(textOf(alert.preferredAction.title)) : Value();
        call.resolve(Value::Object{{"texts", Value::Array{textOf(alert.title), textOf(alert.message)}}, {"buttons", titles}, {"preferred", preferred}, {"focused", Value()}});
    });
}

// The top alert, known by its words, the project's name among them, pressed at the action of this title.
void pressInQuestion(Call call) {
    const std::string button = call.options()["button"].asString();
    const std::string words = call.options()["words"].asString();
    crossbind::onMainThread([call, button, words] {
        UIAlertController *alert = alertUp();
        if (!alert || textOf(alert.title) != words) {
            call.reject("crossbind e2e: no alert up asks " + words);
            return;
        }
        UIAlertAction *pressed = nil;
        for (UIAlertAction *action in alert.actions) {
            if (textOf(action.title) == button) pressed = action;
        }
        if (!pressed) {
            call.reject("crossbind e2e: the alert has no action " + button);
            return;
        }
        id handler = nil;
        @try {
            handler = [pressed valueForKey:@"handler"];
        } @catch (NSException *exception) {
            call.reject("crossbind e2e: UIAlertAction has no handler key: " + textOf(exception.reason));
            return;
        }
        if (!handler) {
            call.reject("crossbind e2e: the action " + button + " has no handler");
            return;
        }
        void (^run)(UIAlertAction *) = handler;
        [alert.presentingViewController dismissViewControllerAnimated:NO
                                                           completion:^{
                                                               run(pressed);
                                                               call.resolve();
                                                           }];
    });
}

void handLinkAsIos(crossbind::Call call) {
    const std::string url = call.options()["url"].asString();
    crossbind::onMainThread([call, url] {
        UIWindowScene *scene = nil;
        for (UIScene *each in UIApplication.sharedApplication.connectedScenes) {
            if ([each isKindOfClass:UIWindowScene.class]) scene = (UIWindowScene *)each;
        }
        id<UISceneDelegate> delegate = scene.delegate;
        if (![delegate respondsToSelector:@selector(scene:continueUserActivity:)]) {
            call.reject("crossbind e2e: no scene of the app's continues a user activity");
            return;
        }
        NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:NSUserActivityTypeBrowsingWeb];
        activity.webpageURL = [NSURL URLWithString:@(url.c_str())];
        [delegate scene:scene continueUserActivity:activity];
        call.resolve();
    });
}

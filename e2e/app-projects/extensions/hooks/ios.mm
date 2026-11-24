// iOS hands a running app a link of a site its association names as a user activity of the web: the hook hands the
// scene's delegate one, as iOS does, where xcrun simctl openurl stops at SpringBoard's question to its user.
#include "crossbind/extension.h"

#import <UIKit/UIKit.h>

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

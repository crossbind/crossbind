// What an iOS or macOS app does with a user activity the system continues it with, as Handoff from another of its
// user's devices hands it over: a web page's is a site's link, and one of another type reaches the owner of its type.
#import <Foundation/Foundation.h>

#include "app.h"
#include "platform.h"
#include "values.h"

bool continueActivity(void *activity) {
    NSUserActivity *continued = (__bridge NSUserActivity *)activity;
    NSString *page = continued.webpageURL.absoluteString;
    if ([continued.activityType isEqualToString:NSUserActivityTypeBrowsingWeb]) {
        if (page) crossbind::app::openedUrl(textOf(page));
        return page != nil;
    }
    return crossbind::app::continuedActivity({textOf(continued.activityType), valueOfPlist(continued.userInfo ?: @{}), page ? textOf(page) : ""});
}

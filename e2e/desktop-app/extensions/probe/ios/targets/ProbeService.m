#import <UserNotifications/UserNotifications.h>

// The probe's notification service extension, of Objective-C, which marks the title of each notification it is handed.
@interface ProbeNotificationService : UNNotificationServiceExtension
@end

@implementation ProbeNotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request withContentHandler:(void (^)(UNNotificationContent *))contentHandler {
    UNMutableNotificationContent *content = [request.content mutableCopy];
    content.title = [content.title stringByAppendingString:@" (probe)"];
    contentHandler(content);
}

@end

#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>

#include "app.h"
#include "crossbind_app.h"
#include "platform.h"

// What the Apple Event of a link does: it reaches the owner of its scheme, and brings the window to the front, restored
// if minimized.
@interface CrossbindUrlHandler : NSObject
- (void)openUrl:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply;
@end

@implementation CrossbindUrlHandler

- (void)openUrl:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    const char *url = [event paramDescriptorForKeyword:keyDirectObject].stringValue.UTF8String;
    if (!url) return;
    // A link of another scheme, which open -a hands over as well, is none of the app's.
    crossbind::app::openUrlsIn({url});
    showWindow("");
}

@end

std::string resourceDir() { return NSBundle.mainBundle.resourcePath.UTF8String; }

void listenForUrls() {
    static CrossbindUrlHandler *handler = [CrossbindUrlHandler new];
    // AppKit sets a handler of its own as it starts to finish launching, before the launch's link arrives.
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  [NSAppleEventManager.sharedAppleEventManager setEventHandler:handler
                                                                                                   andSelector:@selector(openUrl:withReplyEvent:)
                                                                                                 forEventClass:kInternetEventClass
                                                                                                    andEventID:kAEGetURL];
                                                }];
}

void showError(const std::string &message) {
    [NSApplication sharedApplication];
    // An executable outside a bundle may show no window, which webview's window allows as well.
    if (!NSBundle.mainBundle.bundleIdentifier) [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [NSAlert new];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = [NSString stringWithFormat:@"%@ cannot open", @(CROSSBIND_APP_NAME)];
    alert.informativeText = @(message.c_str());
    [alert runModal];
}

void onQuit(std::function<void()> quit) {
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  quit();
                                                }];
}

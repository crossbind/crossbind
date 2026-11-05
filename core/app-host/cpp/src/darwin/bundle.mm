#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>

#include "app.h"
#include "crossbind_app.h"
#include "platform.h"

// What the Apple Event of a link does: it reaches the owner of its scheme, and brings the window to the front, restored
// if minimized; and that of files, from Finder, the Dock or open -a, which reach the owners of their types.
@interface CrossbindUrlHandler : NSObject
- (void)openUrl:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply;
- (void)openFiles:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply;
@end

@implementation CrossbindUrlHandler

- (void)openUrl:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    const char *url = [event paramDescriptorForKeyword:keyDirectObject].stringValue.UTF8String;
    if (!url) return;
    // A link of another scheme, which open -a hands over as well, is none of the app's.
    crossbind::app::openUrlsIn({url});
    showWindow("");
}

- (void)openFiles:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    NSAppleEventDescriptor *files = [event paramDescriptorForKeyword:keyDirectObject];
    // A list of files, its items counted from 1, or one file alone, which counts none.
    const NSInteger count = files.numberOfItems;
    std::vector<std::string> paths;
    for (NSInteger index = count > 0 ? 1 : 0; index <= count; ++index) {
        NSURL *url = (index > 0 ? [files descriptorAtIndex:index] : files).fileURLValue;
        if (url.path) paths.push_back(url.path.UTF8String);
    }
    if (!paths.empty()) crossbind::app::openedFiles(paths);
    showWindow("");
}

@end

std::string resourceDir() { return NSBundle.mainBundle.resourcePath.UTF8String; }

void listenForUrls() {
    static CrossbindUrlHandler *handler = [CrossbindUrlHandler new];
    // The host takes the files among a launch's arguments itself, which AppKit would open once more: it reads a string.
    [NSUserDefaults.standardUserDefaults registerDefaults:@{@"NSTreatUnknownArgumentsAsOpen" : @"NO"}];
    // AppKit sets a handler of its own as it starts to finish launching, before the launch's link arrives.
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  answerLaunches();
                                                  [NSAppleEventManager.sharedAppleEventManager setEventHandler:handler
                                                                                                   andSelector:@selector(openUrl:withReplyEvent:)
                                                                                                 forEventClass:kInternetEventClass
                                                                                                    andEventID:kAEGetURL];
                                                  [NSAppleEventManager.sharedAppleEventManager setEventHandler:handler
                                                                                                   andSelector:@selector(openFiles:withReplyEvent:)
                                                                                                 forEventClass:kCoreEventClass
                                                                                                    andEventID:kAEOpenDocuments];
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

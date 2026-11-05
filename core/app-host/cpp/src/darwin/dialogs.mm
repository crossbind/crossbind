#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#endif
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#include "crossbind_app.h"
#include "page_requests.h"
#include "platform.h"

#include <optional>
#include <string>
#include <vector>

using crossbind::FileInput;
using crossbind::PageDialog;
namespace app = crossbind::app;

namespace {

std::string utf8(NSString *text) { return text.UTF8String ?: ""; }

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void askDialog(PageDialog::Kind kind, NSString *message, NSString *text, std::function<void(std::optional<std::string>)> answer) {
    app::askPageDialog(PageDialog(std::make_shared<PageDialog::State>(kind, utf8(message), utf8(text), std::move(answer))));
}

}  // namespace

#if TARGET_OS_IPHONE
bool presentOnTop(void *controller, void *window) {
    UIViewController *top = ((__bridge UIWindow *)window).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (!top || top.isBeingDismissed) return false;
    [top presentViewController:(__bridge UIViewController *)controller animated:YES completion:nil];
    return true;
}
#endif

// WKWebView leaves the page's dialogs, what it asks to use and its file inputs to its UI delegate, which hands each to
// its owner, the extension of its name. It answers no selector of one without an owner, where WebKit does as it would
// without the delegate: alert() returns at once, confirm() answers false, prompt() null, and no picker shows.
@interface CBPageDelegate : NSObject <WKUIDelegate>
@end

@implementation CBPageDelegate

// WebKit asks which selectors the delegate answers once, as it is set.
- (BOOL)respondsToSelector:(SEL)selector {
    if (selector == @selector(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:) ||
        selector == @selector(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:) ||
        selector == @selector(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)) {
        return app::hasPageDialogs();
    }
    if (selector == NSSelectorFromString(@"webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:")) {
        return app::hasFileInputs() && [super respondsToSelector:selector];
    }
    if (selector == @selector(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:) ||
        selector == NSSelectorFromString(@"webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:") ||
        selector == NSSelectorFromString(@"_webView:requestGeolocationPermissionForFrame:decisionHandler:") ||
        selector == NSSelectorFromString(@"webView:requestDeviceOrientationAndMotionPermissionForOrigin:initiatedByFrame:decisionHandler:")) {
        return app::hasPagePermissions() && [super respondsToSelector:selector];
    }
    return [super respondsToSelector:selector];
}

- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                      initiatedByFrame:(WKFrameInfo *)frame
                     completionHandler:(void (^)(void))done {
    void (^answer)(void) = [done copy];
    askDialog(PageDialog::Kind::alert, message, nil, [answer](std::optional<std::string>) { answer(); });
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL))done {
    void (^answer)(BOOL) = [done copy];
    askDialog(PageDialog::Kind::confirm, message, nil, [answer](std::optional<std::string> text) { answer(text.has_value()); });
}

- (void)webView:(WKWebView *)webView
    runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt
                              defaultText:(NSString *)text
                         initiatedByFrame:(WKFrameInfo *)frame
                        completionHandler:(void (^)(NSString *))done {
    void (^answer)(NSString *) = [done copy];
    askDialog(PageDialog::Kind::prompt, prompt, text, [answer](std::optional<std::string> given) { answer(given ? ns(*given) : nil); });
}

#if !TARGET_OS_IPHONE
// A file input; iOS's WKWebView shows its own picker, which no extension takes.
- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *))done {
    void (^answer)(NSArray<NSURL *> *) = [done copy];
    app::askFileInput(FileInput(std::make_shared<FileInput::State>(
        parameters.allowsMultipleSelection, parameters.allowsDirectories, std::vector<std::string>{},
        [answer](std::optional<std::vector<std::string>> paths) {
            if (!paths) {
                answer(nil);
                return;
            }
            NSMutableArray<NSURL *> *picked = [NSMutableArray array];
            for (const auto &path : *paths) [picked addObject:[NSURL fileURLWithPath:ns(path)]];
            answer(picked);
        })));
}
#endif

// The camera and microphone the page asks for: one page-permissions allows the system asks the app's user for, with
// app.permissions' reason, and WebKit asks nothing of its own.
- (void)webView:(WKWebView *)webView
    requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin
                          initiatedByFrame:(WKFrameInfo *)frame
                                      type:(WKMediaCaptureType)type
                           decisionHandler:(void (^)(WKPermissionDecision))decide API_AVAILABLE(macos(12.0), ios(15.0)) {
    std::vector<std::string> kinds;
    if (type != WKMediaCaptureTypeMicrophone) kinds.emplace_back("camera");
    if (type != WKMediaCaptureTypeCamera) kinds.emplace_back("microphone");
    void (^answer)(WKPermissionDecision) = [decide copy];
    app::askPagePermission(app::pagePermission(std::move(kinds), app::originOf(origin), [answer](bool isAllowed) {
        answer(isAllowed ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
    }));
}

// The location, which the system then asks the app's user for.
- (void)webView:(WKWebView *)webView
    requestGeolocationPermissionForOrigin:(WKSecurityOrigin *)origin
                         initiatedByFrame:(WKFrameInfo *)frame
                          decisionHandler:(void (^)(WKPermissionDecision))decide API_AVAILABLE(macos(27.0), ios(27.0)) {
    void (^answer)(WKPermissionDecision) = [decide copy];
    app::askPagePermission(app::pagePermission({"location"}, app::originOf(origin), [answer](bool isAllowed) {
        answer(isAllowed ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
    }));
}

#if TARGET_OS_IPHONE
// The device's motion and orientation, which the system gives the app without asking.
- (void)webView:(WKWebView *)webView
    requestDeviceOrientationAndMotionPermissionForOrigin:(WKSecurityOrigin *)origin
                                        initiatedByFrame:(WKFrameInfo *)frame
                                         decisionHandler:(void (^)(WKPermissionDecision))decide {
    void (^answer)(WKPermissionDecision) = [decide copy];
    app::askPagePermission(app::pagePermission({"motion"}, app::originOf(origin), [answer](bool isAllowed) {
        answer(isAllowed ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
    }));
}
#endif

#if TARGET_OS_IPHONE && CROSSBIND_APP_PERMISSION_LOCATION
// Before iOS 27 WebKit asks a private selector of the UI delegate instead, which only an app that lists the location
// answers. Another carries no reason for it, without which CoreLocation asks the app's user nothing. A macOS page's
// location comes from the extension page-location.
- (void)_webView:(WKWebView *)webView requestGeolocationPermissionForFrame:(WKFrameInfo *)frame decisionHandler:(void (^)(BOOL))decide {
    void (^answer)(BOOL) = [decide copy];
    app::askPagePermission(app::pagePermission({"location"}, app::originOf(frame.securityOrigin), [answer](bool isAllowed) { answer(isAllowed); }));
}
#endif

@end

// CBPageDelegate, the webview's UI delegate, answers what the page asks to use on Apple's platforms.
void answerPermissions(void *) {}

void showPageDialogs(void *webView) {
    WKWebView *view = (__bridge WKWebView *)webView;
    CBPageDelegate *delegate = [CBPageDelegate new];
    // The webview holds its UI delegate weakly. On macOS webview's window releases the UI delegate it finds when it
    // goes, as it owns the one it set itself, so it gets a reference to this one.
#if TARGET_OS_IPHONE
    static char key;
    objc_setAssociatedObject(view, &key, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
#else
    (void)CFBridgingRetain(delegate);
#endif
    view.UIDelegate = delegate;
}

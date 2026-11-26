// Apple's own for the preview extension: the keychain keeps the app's token, CommonCrypto makes HMAC-SHA256 and SHA-256,
// ASWebAuthenticationSession shows the page that approves a sign-in, never the default browser; a project's question is
// a sheet of its window on macOS and an alert on iOS; and what shows that a preview is one is a pill in a window of the
// extension's own above the page on iOS, the window's title and a Preview menu in the menu bar on macOS.
#include "preview.h"

#include <cstdlib>
#include <map>
#include <memory>

#import <AuthenticationServices/AuthenticationServices.h>
#import <CommonCrypto/CommonDigest.h>
#import <CommonCrypto/CommonHMAC.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <WebKit/WebKit.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

@interface CBPreviewSheetAnchor : NSObject <ASWebAuthenticationPresentationContextProviding>
@end

@implementation CBPreviewSheetAnchor
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    return (__bridge ASPresentationAnchor)crossbind::appWindow();
}
@end

#if TARGET_OS_IPHONE
// The pill's window, on the scene of the preview's, above the page, its alerts and the system's player: as large as the
// scene, so that what it presents is as well, and touched at the pill and at what it presents alone, a touch elsewhere
// going to the window below. Its pill opens the preview's menu.
@interface CBPreviewPillWindow : UIWindow
@property(nonatomic, weak) UIButton *pill;
@property(nonatomic, copy) NSString *project;
@property(nonatomic, copy) NSString *line;
@end

// Its controller, which leaves the status bar and the screen's turns to the app's window below.
@interface CBPreviewPillController : UIViewController
@property(nonatomic, weak) UIWindow *below;
@end

@implementation CBPreviewPillWindow

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *hit = [super hitTest:point withEvent:event];
    if (self.rootViewController.presentedViewController) return hit;
    return self.pill && [hit isDescendantOfView:self.pill] ? hit : nil;
}

- (UIViewController *)topPresenter {
    UIViewController *top = self.rootViewController;
    while (top.presentedViewController && !top.presentedViewController.isBeingDismissed) top = top.presentedViewController;
    return top;
}

// No menu over what the window presents already: the menu itself, or the consent's question until it is answered.
- (void)openMenu:(UIButton *)pill {
    if (self.rootViewController.presentedViewController) return;
    UIAlertController *menu = [UIAlertController alertControllerWithTitle:self.project message:self.line preferredStyle:UIAlertControllerStyleActionSheet];
    [menu addAction:[UIAlertAction actionWithTitle:@"Reload" style:UIAlertActionStyleDefault handler:^(UIAlertAction *) { preview::reloadPreview(); }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Close preview" style:UIAlertActionStyleDefault handler:^(UIAlertAction *) { preview::closePreview(); }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    menu.popoverPresentationController.sourceView = pill;
    menu.popoverPresentationController.sourceRect = pill.bounds;
    [[self topPresenter] presentViewController:menu animated:YES completion:nil];
}

@end

@implementation CBPreviewPillController

- (UIViewController *)shown {
    return self.below.rootViewController;
}

- (UIStatusBarStyle)preferredStatusBarStyle {
    return self.shown ? self.shown.preferredStatusBarStyle : UIStatusBarStyleDefault;
}

- (BOOL)prefersStatusBarHidden {
    return self.shown.prefersStatusBarHidden;
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations {
    return self.shown ? self.shown.supportedInterfaceOrientations : UIInterfaceOrientationMaskAll;
}

@end
#else
// The Preview menu's actions.
@interface CBPreviewMenuTarget : NSObject
@end

@implementation CBPreviewMenuTarget

- (void)reload:(id)sender {
    preview::reloadPreview();
}

- (void)closePreview:(id)sender {
    preview::closePreview();
}

@end
#endif

namespace preview {
namespace {

CBPreviewSheetAnchor *anchor;
ASWebAuthenticationSession *shown;

NSString *stringOf(const std::string &text) {
    return [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding] ?: @"";
}

// The item of the app's token for a cloud: a generic password of the app's service, by the cloud's address; on macOS in
// the data protection keychain where the app's signing gives it one, as the Mac App Store's does.
NSMutableDictionary *itemOf(const std::string &cloud, bool isDataProtection) {
    NSMutableDictionary *item = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: stringOf(config().service),
        (__bridge id)kSecAttrAccount: stringOf(cloud),
    } mutableCopy];
#if !TARGET_OS_IPHONE
    if (isDataProtection) item[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
#endif
    return item;
}

std::string wordsOf(OSStatus status) {
    NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, nullptr));
    return "the keychain answered " + std::to_string(status) + (message ? ": " + std::string(message.UTF8String) : "");
}

// Whether the app's signing gives it the data protection keychain, as the Mac App Store's does with the application
// identifier its profile names: asked once. A build without it, as a development build, keeps its token in the
// file-based keychain alone, which asks its user once a build; one with it never reads the file-based one.
bool hasDataProtection() {
#if TARGET_OS_IPHONE
    return true;
#else
    static const bool isGiven = [] {
        SecTaskRef task = SecTaskCreateFromSelf(nullptr);
        if (!task) return false;
        CFTypeRef identifier = SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.application-identifier"), nullptr);
        CFRelease(task);
        if (!identifier) return false;
        CFRelease(identifier);
        return true;
    }();
    return isGiven;
#endif
}

// One keychain operation, on a queue of its own, as the file-based keychain may wait for its user's answer.
void inKeychain(std::function<OSStatus(bool isDataProtection)> operation, std::function<void(OSStatus)> done) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        done(operation(hasDataProtection()));
    });
}

}  // namespace

void hmacSha256(const std::string &key, const std::string &text, Digest done) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CCHmac(kCCHmacAlgSHA256, key.data(), key.size(), text.data(), text.size(), digest);
    done(std::nullopt, std::string(reinterpret_cast<const char *>(digest), sizeof digest));
}

void sha256(const std::string &text, Digest done) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(text.data(), static_cast<CC_LONG>(text.size()), digest);
    done(std::nullopt, std::string(reinterpret_cast<const char *>(digest), sizeof digest));
}

std::string randomBytes(std::size_t count) {
    std::string bytes(count, '\0');
    arc4random_buf(bytes.data(), count);
    return bytes;
}

void readSecret(const std::string &cloud, std::function<void(Failure failure, std::optional<std::string> secret)> done) {
    auto found = std::make_shared<std::optional<std::string>>();
    inKeychain(
        [cloud, found](bool isDataProtection) {
            NSMutableDictionary *item = itemOf(cloud, isDataProtection);
            item[(__bridge id)kSecReturnData] = @YES;
            item[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
            CFTypeRef result = nullptr;
            const OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)item, &result);
            if (status == errSecSuccess) {
                NSData *data = CFBridgingRelease(result);
                *found = std::string(static_cast<const char *>(data.bytes), data.length);
            }
            return status;
        },
        [found, done](OSStatus status) {
            if (status == errSecSuccess || status == errSecItemNotFound) done(std::nullopt, *found);
            else done(wordsOf(status), std::nullopt);
        });
}

void writeSecret(const std::string &cloud, const std::string &secret, Done done) {
    inKeychain(
        [cloud, secret](bool isDataProtection) {
            NSData *data = [NSData dataWithBytes:secret.data() length:secret.size()];
            NSMutableDictionary *item = itemOf(cloud, isDataProtection);
            const OSStatus updated = SecItemUpdate((__bridge CFDictionaryRef)item, (__bridge CFDictionaryRef) @{(__bridge id)kSecValueData: data});
            if (updated != errSecItemNotFound) return updated;
            item[(__bridge id)kSecValueData] = data;
            // On this device alone, once it was first unlocked: no backup takes it to another.
#if TARGET_OS_IPHONE
            item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
#else
            if (isDataProtection) item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
#endif
            return SecItemAdd((__bridge CFDictionaryRef)item, nullptr);
        },
        [done](OSStatus status) { done(status == errSecSuccess ? Failure() : Failure(wordsOf(status))); });
}

void deleteSecret(const std::string &cloud, Done done) {
    inKeychain([cloud](bool isDataProtection) { return SecItemDelete((__bridge CFDictionaryRef)itemOf(cloud, isDataProtection)); },
        [done](OSStatus status) { done(status == errSecSuccess || status == errSecItemNotFound ? Failure() : Failure(wordsOf(status))); });
}

// The page in the system's sign-in sheet, which its user closes once the page shows the number; it shares the system
// browser's sign-ins, as with GitHub or Apple.
void openSignInPage(const std::string &url, Done done) {
    crossbind::onMainThread([url, done] {
        NSURL *address = [NSURL URLWithString:stringOf(url)];
        if (!address) {
            done("crossbind: the sign-in page's address is no URL: " + url);
            return;
        }
        [shown cancel];
        __block __weak ASWebAuthenticationSession *opened = nil;
        ASWebAuthenticationSession *session = [[ASWebAuthenticationSession alloc] initWithURL:address
                                                                           callbackURLScheme:nil
                                                                           completionHandler:^(NSURL *, NSError *) {
                                                                               if (shown != nil && shown == opened) shown = nil;
                                                                           }];
        opened = session;
        if (!anchor) anchor = [CBPreviewSheetAnchor new];
        session.presentationContextProvider = anchor;
        if (![session start]) {
            done("crossbind: the system did not show the sign-in page.");
            return;
        }
        shown = session;
        done(std::nullopt);
    });
}

std::string platformName() {
#if TARGET_OS_IPHONE
    return UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad ? "ipados" : "ios";
#else
    return "macos";
#endif
}

std::string systemVersion() {
    const NSOperatingSystemVersion version = NSProcessInfo.processInfo.operatingSystemVersion;
    std::string text = std::to_string(version.majorVersion) + "." + std::to_string(version.minorVersion);
    if (version.patchVersion > 0) text += "." + std::to_string(version.patchVersion);
    return text;
}

bool asksForLocalNetwork() { return true; }

#if TARGET_OS_IPHONE
namespace {

// The pills, by the id of the window each is over, on the main thread.
NSMapTable<NSNumber *, CBPreviewPillWindow *> *pills;

CBPreviewPillWindow *pillOf(uint64_t window) {
    return [pills objectForKey:@(window)];
}

UIButton *pillButton(CBPreviewPillWindow *window) {
    UIButtonConfiguration *look = [UIButtonConfiguration filledButtonConfiguration];
    look.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    look.buttonSize = UIButtonConfigurationSizeSmall;
    look.title = @"Preview";
    look.imagePadding = 4;
    // The app's mark, where the system gives the app's icon by its name.
    if (UIImage *mark = [UIImage imageNamed:@"AppIcon"]) {
        look.image = [[[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(16, 16)] imageWithActions:^(UIGraphicsImageRendererContext *) {
            [[UIBezierPath bezierPathWithRoundedRect:CGRectMake(0, 0, 16, 16) cornerRadius:4] addClip];
            [mark drawInRect:CGRectMake(0, 0, 16, 16)];
        }];
    }
    UIButton *pill = [UIButton buttonWithConfiguration:look primaryAction:nil];
    [pill addTarget:window action:@selector(openMenu:) forControlEvents:UIControlEventTouchUpInside];
    pill.translatesAutoresizingMaskIntoConstraints = NO;
    return pill;
}

}  // namespace

void showIndicator(uint64_t window, const Shown &shown, std::function<void()> done) {
    crossbind::onMainThread([window, shown, done] {
        if (!pills) pills = [NSMapTable strongToStrongObjectsMapTable];
        CBPreviewPillWindow *pill = pillOf(window);
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        UIWindow *below = open ? (__bridge UIWindow *)open->native() : nil;
        if (!pill && below.windowScene) {
            pill = [[CBPreviewPillWindow alloc] initWithWindowScene:below.windowScene];
            pill.windowLevel = UIWindowLevelAlert + 1;
            pill.backgroundColor = UIColor.clearColor;
            CBPreviewPillController *controller = [CBPreviewPillController new];
            controller.below = below;
            controller.view.backgroundColor = UIColor.clearColor;
            pill.rootViewController = controller;
            UIButton *button = pillButton(pill);
            [controller.view addSubview:button];
            UILayoutGuide *safe = controller.view.safeAreaLayoutGuide;
            [NSLayoutConstraint activateConstraints:@[
                [button.topAnchor constraintEqualToAnchor:safe.topAnchor constant:4],
                [button.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-8],
                [button.heightAnchor constraintEqualToConstant:28],
            ]];
            pill.pill = button;
            pill.hidden = NO;
            [pills setObject:pill forKey:@(window)];
        }
        pill.project = stringOf(shown.project);
        pill.line = stringOf(shown.line);
        pill.pill.accessibilityLabel = [pill.project stringByAppendingString:@" \u2013 crossbind preview"];
        done();
    });
}

// What the pill's window presents goes with it: its menu, and a question its preview's end closes as well.
void hideIndicator(uint64_t window) {
    crossbind::onMainThread([window] {
        CBPreviewPillWindow *pill = pillOf(window);
        if (!pill) return;
        [pills removeObjectForKey:@(window)];
        [pill.rootViewController dismissViewControllerAnimated:NO completion:nil];
        pill.hidden = YES;
    });
}

namespace {

// Whether the question's alert shows, and whether it was closed, on the main thread.
struct Presented {
    bool isShown = false;
    bool isClosed = false;
};

}  // namespace

// An alert over whatever the window shows on top, a page's own alert among it, from the pill's window where the
// preview's window has one: Don't Allow its preferred action, which a keyboard's Return presses, and neither of the
// cancel style, which Escape would press. It closes once it shows, as a dismissal during its presentation does not take.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done) {
    const std::optional<crossbind::Window> open = crossbind::windowOf(window);
    // A request that names no window is asked over the app's oldest.
    const std::vector<crossbind::Window> windows = crossbind::openWindows();
    const uint64_t over = open ? open->id() : windows.empty() ? 0 : windows.front().id();
    UIWindow *presenting = pillOf(over) ?: (__bridge UIWindow *)(open ? open->native() : crossbind::appWindow());
    UIViewController *top = presenting.rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (!top || top.isBeingDismissed) {
        done(std::nullopt);
        return nullptr;
    }
    auto state = std::make_shared<Presented>();
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:stringOf(message)
                                                                   message:stringOf(detail)
                                                            preferredStyle:UIAlertControllerStyleAlert];
    UIAlertAction *dontAllow = [UIAlertAction actionWithTitle:@"Don't Allow"
                                                        style:UIAlertActionStyleDefault
                                                      handler:^(UIAlertAction *) {
                                                          if (!state->isClosed) done(false);
                                                      }];
    [alert addAction:dontAllow];
    [alert addAction:[UIAlertAction actionWithTitle:@"Allow"
                                              style:UIAlertActionStyleDefault
                                            handler:^(UIAlertAction *) {
                                                if (!state->isClosed) done(true);
                                            }]];
    alert.preferredAction = dontAllow;
    __weak UIAlertController *shown = alert;
    [top presentViewController:alert
                      animated:YES
                    completion:^{
                        state->isShown = true;
                        if (state->isClosed) [shown.presentingViewController dismissViewControllerAnimated:NO completion:nil];
                    }];
    return [state, shown] {
        dispatch_async(dispatch_get_main_queue(), ^{
            state->isClosed = true;
            if (state->isShown) [shown.presentingViewController dismissViewControllerAnimated:NO completion:nil];
        });
    };
}
#else
namespace {

// What a window the indicator is up on had before it, which it gets back once it comes down: its title, its full
// screen, and its web view's, on the main thread.
struct Marked {
    NSString *title;
    NSWindowCollectionBehavior behavior;
    BOOL isWebFullScreen;
};
std::map<uint64_t, Marked> marked;
CBPreviewMenuTarget *menuTarget;
// The Preview menu, in the menu bar while a window shows a preview, and its line.
NSMenuItem *previewItem;
NSMenuItem *lineItem;

BOOL webFullScreenOf(WKWebView *web) {
    if (@available(macOS 12.3, *)) return web.configuration.preferences.elementFullscreenEnabled;
    return [[web.configuration.preferences valueForKey:@"fullScreenEnabled"] boolValue];
}

void setWebFullScreen(WKWebView *web, BOOL isOn) {
    if (@available(macOS 12.3, *)) web.configuration.preferences.elementFullscreenEnabled = isOn;
    else [web.configuration.preferences setValue:@(isOn) forKey:@"fullScreenEnabled"];
}

// The project's name over its line, drawn as text.
NSAttributedString *nameOverLine(const Shown &shown) {
    NSMutableAttributedString *text = [[NSMutableAttributedString alloc] initWithString:stringOf(shown.project)
                                                                             attributes:@{NSFontAttributeName: [NSFont menuFontOfSize:0]}];
    NSDictionary *below = @{NSFontAttributeName: [NSFont menuFontOfSize:NSFont.smallSystemFontSize], NSForegroundColorAttributeName: NSColor.secondaryLabelColor};
    [text appendAttributedString:[[NSAttributedString alloc] initWithString:[@"\n" stringByAppendingString:stringOf(shown.line)] attributes:below]];
    return text;
}

// Reload, the project's line, which does nothing, and Close preview, before the Window menu.
void showMenu(const Shown &shown) {
    if (!previewItem) {
        menuTarget = [CBPreviewMenuTarget new];
        NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Preview"];
        menu.autoenablesItems = NO;
        [menu addItemWithTitle:@"Reload" action:@selector(reload:) keyEquivalent:@""].target = menuTarget;
        lineItem = [menu addItemWithTitle:@"" action:nil keyEquivalent:@""];
        lineItem.enabled = NO;
        [menu addItemWithTitle:@"Close preview" action:@selector(closePreview:) keyEquivalent:@""].target = menuTarget;
        previewItem = [[NSMenuItem alloc] initWithTitle:@"Preview" action:nil keyEquivalent:@""];
        previewItem.submenu = menu;
    }
    lineItem.attributedTitle = nameOverLine(shown);
    NSMenu *bar = NSApp.mainMenu;
    if (!bar || previewItem.menu == bar) return;
    [previewItem.menu removeItem:previewItem];
    const NSInteger window = NSApp.windowsMenu ? [bar indexOfItemWithSubmenu:NSApp.windowsMenu] : -1;
    [bar insertItem:previewItem atIndex:window >= 0 ? window : bar.numberOfItems];
}

NSString *titleOf(const Shown &shown) {
    return [stringOf(shown.project) stringByAppendingString:@" \u2013 crossbind preview"];
}

}  // namespace

// The window's title says it shows a preview, the Preview menu is in the menu bar, and neither the page nor the window's
// user takes the window full screen, which would hide the title: the web view's own full screen is off, the green button
// zooms, and a window that fills the screen leaves it before the preview's page loads.
void showIndicator(uint64_t window, const Shown &shown, std::function<void()> done) {
    crossbind::onMainThread([window, shown, done] {
        showMenu(shown);
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        NSWindow *native = open ? (__bridge NSWindow *)open->native() : nil;
        if (!native) {
            done();
            return;
        }
        const bool isNew = !marked.count(window);
        WKWebView *web = (__bridge WKWebView *)open->webView();
        if (isNew) marked[window] = Marked{native.title, native.collectionBehavior, webFullScreenOf(web)};
        native.title = titleOf(shown);
        // Off before the project's page loads, so that its document has no full screen to ask for.
        setWebFullScreen(web, NO);
        if (!isNew) {
            done();
            return;
        }
        const NSWindowCollectionBehavior none = (native.collectionBehavior & ~(NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenAuxiliary))
            | NSWindowCollectionBehaviorFullScreenNone;
        if (!(native.styleMask & NSWindowStyleMaskFullScreen)) {
            native.collectionBehavior = none;
            done();
            return;
        }
        auto isLeft = std::make_shared<bool>(false);
        __weak NSWindow *weakWindow = native;
        void (^left)(void) = ^{
            if (*isLeft) return;
            *isLeft = true;
            if (marked.count(window) && weakWindow) weakWindow.collectionBehavior = none;
            done();
        };
        __block id observer = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidExitFullScreenNotification
                                                                              object:native
                                                                               queue:NSOperationQueue.mainQueue
                                                                          usingBlock:^(NSNotification *) {
                                                                              [NSNotificationCenter.defaultCenter removeObserver:observer];
                                                                              left();
                                                                          }];
        [native toggleFullScreen:nil];
        // AppKit tells of no exit it does not make.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), left);
    });
}

void hideIndicator(uint64_t window) {
    crossbind::onMainThread([window] {
        const auto found = marked.find(window);
        if (found != marked.end()) {
            if (const std::optional<crossbind::Window> open = crossbind::windowOf(window)) {
                NSWindow *native = (__bridge NSWindow *)open->native();
                native.title = found->second.title;
                native.collectionBehavior = found->second.behavior;
            }
            marked.erase(found);
        }
        if (marked.empty() && previewItem.menu) [previewItem.menu removeItem:previewItem];
    });
}

// The web view's own full screen as it was, as the preview ends: the app's page that comes next is made with it.
void giveWebFullScreenBack(const crossbind::Window &open) {
    const auto found = marked.find(open.id());
    if (found != marked.end()) setWebFullScreen((__bridge WKWebView *)open.webView(), found->second.isWebFullScreen);
}

// A sheet of the window, which leaves the menu bar and the app's other windows working: Don't Allow its first button,
// which Return presses, and Escape none, as NSAlert gives Escape to a button named Cancel alone. A sheet that ends by
// neither button, as when another's code ends it, answers as one that could not be shown.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done) {
    const std::optional<crossbind::Window> open = crossbind::windowOf(window);
    NSWindow *parent = (__bridge NSWindow *)(open ? open->native() : crossbind::appWindow());
    if (!parent) {
        done(std::nullopt);
        return nullptr;
    }
    NSAlert *alert = [NSAlert new];
    alert.messageText = stringOf(message);
    alert.informativeText = stringOf(detail);
    [alert addButtonWithTitle:@"Don't Allow"].keyEquivalent = @"\r";
    [alert addButtonWithTitle:@"Allow"].keyEquivalent = @"";
    auto isClosed = std::make_shared<bool>(false);
    [alert beginSheetModalForWindow:parent
                  completionHandler:^(NSModalResponse response) {
                      if (*isClosed) return;
                      if (response == NSAlertFirstButtonReturn) done(false);
                      else if (response == NSAlertSecondButtonReturn) done(true);
                      else done(std::nullopt);
                  }];
    __weak NSAlert *shown = alert;
    __weak NSWindow *weakParent = parent;
    // A sheet asked while another shows waits behind it among the window's sheets, which endSheet takes it from.
    return [isClosed, shown, weakParent] {
        dispatch_async(dispatch_get_main_queue(), ^{
            *isClosed = true;
            NSWindow *sheet = shown.window;
            if (sheet && [weakParent.sheets containsObject:sheet]) [weakParent endSheet:sheet returnCode:NSModalResponseAbort];
        });
    };
}
#endif

void endIndicator(uint64_t window, std::function<void(bool isShowingProject)> done) {
    crossbind::onMainThread([window, done] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
#if !TARGET_OS_IPHONE
        if (open) giveWebFullScreenBack(*open);
#endif
        done(open && open->page().role() == "project");
    });
}

void reloadWindow(uint64_t window) {
    crossbind::onMainThread([window] {
        if (const std::optional<crossbind::Window> open = crossbind::windowOf(window)) [(__bridge WKWebView *)open->webView() reload];
    });
}

}  // namespace preview

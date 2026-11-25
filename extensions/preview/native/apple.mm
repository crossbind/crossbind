// Apple's own for the preview extension: the keychain keeps the app's token, CommonCrypto makes HMAC-SHA256 and SHA-256,
// ASWebAuthenticationSession shows the page that approves a sign-in, never the default browser, and a project's
// question is a sheet of its window on macOS and an alert on iOS.
#include "preview.h"

#include <cstdlib>
#include <memory>

#import <AuthenticationServices/AuthenticationServices.h>
#import <CommonCrypto/CommonDigest.h>
#import <CommonCrypto/CommonHMAC.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
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

// Whether the question's alert shows, and whether it was closed, on the main thread.
struct Shown {
    bool isShown = false;
    bool isClosed = false;
};

}  // namespace

// An alert over whatever the window shows on top, a page's own alert among it: Don't Allow its preferred action, which
// a keyboard's Return presses, and neither of the cancel style, which Escape would press. It closes once it shows, as a
// dismissal during its presentation does not take.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done) {
    const std::optional<crossbind::Window> open = crossbind::windowOf(window);
    UIViewController *top = ((__bridge UIWindow *)(open ? open->native() : crossbind::appWindow())).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (!top || top.isBeingDismissed) {
        done(std::nullopt);
        return nullptr;
    }
    auto state = std::make_shared<Shown>();
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
// A sheet of the window, which leaves the menu bar and the app's other windows working: Don't Allow its first button,
// which Return presses, and Escape none, as NSAlert gives Escape to a button named Cancel alone.
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

}  // namespace preview

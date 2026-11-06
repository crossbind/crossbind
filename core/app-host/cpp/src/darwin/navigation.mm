#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>
#endif
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#include "page_requests.h"
#include "platform.h"

#include <algorithm>
#include <cstdio>

using crossbind::CertificateError;
using crossbind::Download;
using crossbind::DownloadEnd;
using crossbind::HttpAuthentication;
namespace app = crossbind::app;

namespace {

// How often a download's owner hears what has arrived.
constexpr NSTimeInterval PROGRESS_SECONDS = 0.1;

void openOutside(NSURL *url) {
#if TARGET_OS_IPHONE
    [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
#else
    [NSWorkspace.sharedWorkspace openURL:url];
#endif
}

std::string text(NSString *string) { return string.UTF8String ?: ""; }

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

// The host a protection space names, as an origin names it: with its port, but for http's and https' own.
std::string hostOf(NSURLProtectionSpace *space) {
    std::string host = text(space.host);
    if (space.port != 0 && space.port != 80 && space.port != 443) host += ":" + std::to_string(space.port);
    return host;
}

// The server's own certificate, the first of its chain.
NSData *leafOf(SecTrustRef trust) {
    SecCertificateRef leaf = nullptr;
    CFArrayRef chain = nullptr;
    if (@available(macOS 12.0, iOS 15.0, *)) {
        chain = SecTrustCopyCertificateChain(trust);
        if (chain && CFArrayGetCount(chain) > 0) leaf = static_cast<SecCertificateRef>(const_cast<void *>(CFArrayGetValueAtIndex(chain, 0)));
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        leaf = SecTrustGetCertificateAtIndex(trust, 0);
#pragma clang diagnostic pop
    }
    NSData *data = leaf ? CFBridgingRelease(SecCertificateCopyData(leaf)) : nil;
    if (chain) CFRelease(chain);
    return data;
}

// Whether App Transport Security lets the app's webviews take a certificate the system does not trust, as the app's
// Info.plist exempts their loads, or every load, from it.
bool isWebContentExempt() {
    NSDictionary *security = [NSBundle.mainBundle objectForInfoDictionaryKey:@"NSAppTransportSecurity"];
    if (![security isKindOfClass:NSDictionary.class]) return false;
    const auto isOn = [security](NSString *key) {
        id value = security[key];
        return [value isKindOfClass:NSNumber.class] && [value boolValue];
    };
    return isOn(@"NSAllowsArbitraryLoadsInWebContent") || isOn(@"NSAllowsArbitraryLoads");
}

}  // namespace

// A download's place as it arrives, and what its owner hears of it.
@interface CBDownload : NSObject {
@public
    std::string url;
    std::shared_ptr<app::DownloadEvents> events;
    // Where it goes, and the file it arrives in beside it till it is whole; on iOS, after ask(), the file alone, in a
    // folder of its own among the app's temporary files, which the export sheet moves.
    NSURL *target;
    NSURL *arrival;
    // Whether ask() saves it, so the app's user hears of a failure.
    BOOL isAsked;
    NSTimer *timer;
}
@end

@implementation CBDownload
@end

// page-downloads answers each download the page starts before any of it arrives.
API_AVAILABLE(macos(11.3), ios(14.5))
@interface CBDownloads : NSObject <WKDownloadDelegate> {
    NSMapTable<WKDownload *, CBDownload *> *running;
#if TARGET_OS_IPHONE
    // What ask() saved, each with its window, waiting for the export sheet, which UIKit shows one at a time, and the
    // one it shows.
    NSMutableArray<NSArray *> *waiting;
    CBDownload *shown;
#endif
}
@end

#if TARGET_OS_IPHONE
@interface CBDownloads () <UIDocumentPickerDelegate>
@end
#endif

@implementation CBDownloads

- (instancetype)init {
    if ((self = [super init])) {
        running = [NSMapTable weakToStrongObjectsMapTable];
#if TARGET_OS_IPHONE
        waiting = [NSMutableArray new];
#endif
    }
    return self;
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
                 suggestedFilename:(NSString *)name
                 completionHandler:(void (^)(NSURL *))done {
    CBDownload *record = [CBDownload new];
    record->url = text((response.URL ?: download.originalRequest.URL).absoluteString);
    record->events = std::make_shared<app::DownloadEvents>();
    [running setObject:record forKey:download];
    void (^destination)(NSURL *) = [done copy];
    // The page names a download, and WebKit passes the name on.
    NSString *named = ns(app::fileNameOf(text(name)));
    __weak CBDownloads *weak = self;
    app::askDownload(std::make_shared<app::StateOf<Download>>((__bridge const void *)download.webView, record->url, text(named), text(response.MIMEType),
        response.expectedContentLength, record->events,
        [weak, download, named, destination](app::DownloadAnswer answer) {
            dispatch_async(dispatch_get_main_queue(), ^{
                CBDownloads *downloads = weak;
                if (downloads) {
                    [downloads answer:answer download:download name:named done:destination];
                } else {
                    destination(nil);
                }
            });
        }));
}

- (void)answer:(app::DownloadAnswer)answer download:(WKDownload *)download name:(NSString *)name done:(void (^)(NSURL *))done {
    CBDownload *record = [running objectForKey:download];
    if (!record) {
        done(nil);
    } else if (answer.kind == app::DownloadAnswer::Kind::saveTo) {
        [self start:download record:record at:[NSURL fileURLWithPath:ns(answer.path)] done:done];
    } else if (answer.kind == app::DownloadAnswer::Kind::ask) {
        record->isAsked = YES;
        [self ask:download record:record name:name done:done];
    } else {
        [self drop:download record:record end:DownloadEnd{"", true} done:done];
    }
}

// A download that saves nothing: WebKit cancels it, and its owner hears why.
- (void)drop:(WKDownload *)download record:(CBDownload *)record end:(const DownloadEnd &)end done:(void (^)(NSURL *))done {
    [running removeObjectForKey:download];
    done(nil);
    app::tellFinish(*record->events, record->url, end);
}

// The file arrives beside where it goes and takes its place once whole, so a download that fails leaves the file it
// was to replace as it was.
- (void)start:(WKDownload *)download record:(CBDownload *)record at:(NSURL *)target done:(void (^)(NSURL *))done {
    NSString *part = [NSString stringWithFormat:@".%@.%@.download", target.lastPathComponent, NSUUID.UUID.UUIDString];
    [self start:download record:record target:target arrival:[target.URLByDeletingLastPathComponent URLByAppendingPathComponent:part] done:done];
}

- (void)start:(WKDownload *)download record:(CBDownload *)record target:(NSURL *)target arrival:(NSURL *)arrival done:(void (^)(NSURL *))done {
    // One that failed while its user picked where has ended already.
    if ([running objectForKey:download] != record) {
        done(nil);
        return;
    }
    __weak WKDownload *weak = download;
    if (!app::startDownload(*record->events, [weak] { dispatch_async(dispatch_get_main_queue(), ^{ [weak cancel:nil]; }); })) {
        [self drop:download record:record end:DownloadEnd{"", true} done:done];
        return;
    }
    record->target = target;
    record->arrival = arrival;
    std::shared_ptr<app::DownloadEvents> events = record->events;
    const std::string url = record->url;
    record->timer = [NSTimer scheduledTimerWithTimeInterval:PROGRESS_SECONDS repeats:YES block:^(NSTimer *) {
        NSProgress *progress = weak.progress;
        if (progress) app::tellProgress(*events, url, progress.completedUnitCount, progress.totalUnitCount < 0 ? -1 : progress.totalUnitCount);
    }];
    done(arrival);
}

- (void)downloadDidFinish:(WKDownload *)download {
    CBDownload *record = [running objectForKey:download];
    [running removeObjectForKey:download];
    if (!record) return;
    [record->timer invalidate];
#if TARGET_OS_IPHONE
    if (!record->target) {
        UIWindow *window = download.webView.window;
        [waiting addObject:@[ record, window ? (id)window : NSNull.null ]];
        [self showNext];
        return;
    }
#endif
    NSFileManager *files = NSFileManager.defaultManager;
    BOOL isFolder = NO;
    const BOOL exists = [files fileExistsAtPath:record->target.path isDirectory:&isFolder];
    // macOS's panel asked before it chose a file that exists. A folder stays, as replaceItemAtURL would put the file in
    // its place and its files with it.
    NSError *error = isFolder ? [NSError errorWithDomain:NSCocoaErrorDomain
                                                    code:NSFileWriteFileExistsError
                                                userInfo:@{NSLocalizedDescriptionKey : [@"A folder is at " stringByAppendingString:record->target.path]}]
                              : nil;
    const BOOL isPlaced = !isFolder && (exists ? [files replaceItemAtURL:record->target withItemAtURL:record->arrival backupItemName:nil options:0 resultingItemURL:nil error:&error]
                                               : [files moveItemAtURL:record->arrival toURL:record->target error:&error]);
    if (!isPlaced) {
        [self failed:record error:error window:download.webView.window];
        return;
    }
#if !TARGET_OS_IPHONE
    // Gatekeeper checks it when it is opened, as it checks what a browser saves.
    [record->target setResourceValue:@{(__bridge NSString *)kLSQuarantineTypeKey : (__bridge NSString *)kLSQuarantineTypeWebDownload}
                              forKey:NSURLQuarantinePropertiesKey
                               error:nil];
#endif
    app::tellFinish(*record->events, record->url, DownloadEnd{text(record->target.path)});
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
    CBDownload *record = [running objectForKey:download];
    [running removeObjectForKey:download];
    if (!record) return;
    [record->timer invalidate];
    [self failed:record error:error window:download.webView.window];
}

// One that failed before it had where to go, as while its user picked where, left nothing, and its owner alone hears.
- (void)failed:(CBDownload *)record error:(NSError *)error window:(id)window {
    if (record->arrival) {
        [NSFileManager.defaultManager removeItemAtURL:record->target ? record->arrival : record->arrival.URLByDeletingLastPathComponent error:nil];
    }
    const BOOL isCancelled = [error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled;
    app::tellFinish(*record->events, record->url, isCancelled ? DownloadEnd{"", true} : DownloadEnd{"", false, text(error.localizedDescription)});
    if (record->arrival && record->isAsked && !isCancelled) [self tell:(record->target ?: record->arrival).lastPathComponent error:error over:window];
}

#if TARGET_OS_IPHONE
// What ask() saves arrives in a folder of its own among the app's temporary files, and the system's export sheet moves
// it where its user picks; the folder goes once the sheet does.
- (void)ask:(WKDownload *)download record:(CBDownload *)record name:(NSString *)name done:(void (^)(NSURL *))done {
    NSFileManager *manager = NSFileManager.defaultManager;
    NSURL *folder = [manager.temporaryDirectory URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
    NSError *error = nil;
    if (![manager createDirectoryAtURL:folder withIntermediateDirectories:YES attributes:nil error:&error]) {
        [self tell:name error:error over:download.webView.window];
        [self drop:download record:record end:DownloadEnd{"", false, text(error.localizedDescription)} done:done];
        return;
    }
    [self start:download record:record target:nil arrival:[folder URLByAppendingPathComponent:name isDirectory:NO] done:done];
}

- (void)showNext {
    while (!shown && waiting.count > 0) {
        NSArray *next = waiting.firstObject;
        [waiting removeObjectAtIndex:0];
        CBDownload *record = next[0];
        UIDocumentPickerViewController *sheet = [[UIDocumentPickerViewController alloc] initForExportingURLs:@[ record->arrival ] asCopy:NO];
        sheet.delegate = self;
        UIWindow *window = next[1] == NSNull.null ? nil : next[1];
        if (presentOnTop((__bridge void *)sheet, (__bridge void *)window)) {
            shown = record;
        } else {
            [NSFileManager.defaultManager removeItemAtURL:record->arrival.URLByDeletingLastPathComponent error:nil];
            app::tellFinish(*record->events, record->url, DownloadEnd{"", false, std::string("the app has no window to show the export sheet in")});
        }
    }
}

- (void)documentPicker:(UIDocumentPickerViewController *)sheet didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    [self sheetWentAway:urls.firstObject];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)sheet {
    [self sheetWentAway:nil];
}

- (void)sheetWentAway:(NSURL *)picked {
    CBDownload *record = shown;
    shown = nil;
    if (record) {
        [NSFileManager.defaultManager removeItemAtURL:record->arrival.URLByDeletingLastPathComponent error:nil];
        if (picked) {
            app::tellFinish(*record->events, record->url, DownloadEnd{text(picked.path)});
        } else {
            app::tellFinish(*record->events, record->url, DownloadEnd{"", true});
        }
    }
    [self showNext];
}

- (void)tell:(NSString *)name error:(NSError *)error over:(UIWindow *)window {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:[NSString stringWithFormat:@"%@ was not saved", name]
                                                                   message:error.localizedDescription
                                                            preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    presentOnTop((__bridge void *)alert, (__bridge void *)window);
}
#else
// What ask() saves goes where its user picks in the save panel, as a browser asks.
- (void)ask:(WKDownload *)download record:(CBDownload *)record name:(NSString *)name done:(void (^)(NSURL *))done {
    NSWindow *window = download.webView.window;
    if (!window) {
        [self drop:download record:record end:DownloadEnd{"", false, std::string("the app has no window to ask in")} done:done];
        return;
    }
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = name;
    [panel beginSheetModalForWindow:window completionHandler:^(NSModalResponse result) {
        if (result != NSModalResponseOK) {
            [self drop:download record:record end:DownloadEnd{"", true} done:done];
            return;
        }
        [self start:download record:record at:panel.URL done:done];
    }];
}

- (void)tell:(NSString *)name error:(NSError *)error over:(NSWindow *)window {
    NSAlert *alert = [NSAlert new];
    alert.messageText = [NSString stringWithFormat:@"%@ was not saved", name];
    alert.informativeText = error.localizedDescription ?: @"";
    if (window) {
        [alert beginSheetModalForWindow:window completionHandler:nil];
    } else {
        [alert runModal];
    }
}
#endif

@end

// The app's own origins load in any frame, but a window the page asks for at one of them opens nowhere, as the app's
// windows open through windows.open(); the extension page-navigation decides every other URL, windows too, which load
// in the page's place if they load. A page of another origin gets no token, so it reaches none of the app's functions.
@interface CBNavigationLock : NSObject <WKNavigationDelegate> {
@public
    // The webview it decides for, whose page asks.
    __weak WKWebView *view;
    std::vector<std::string> origins;
    std::function<void()> newPage;
    id downloads;
    // A window's URL page-navigation loaded in the page's place, whose navigation it does not decide again.
    std::string approved;
    // The certificates page-navigation trusted, by their hosts, which the host's later requests take without asking.
    NSMutableDictionary<NSString *, NSMutableSet<NSData *> *> *trusted;
}
@end

@implementation CBNavigationLock

- (BOOL)isApproved:(NSURL *)url {
    const std::string uri = text(url.absoluteString);
    if (approved.empty() || uri != approved) return NO;
    approved.clear();
    return YES;
}

- (BOOL)allows:(NSURL *)url {
    NSString *scheme = url.scheme.lowercaseString;
    if ([scheme isEqualToString:@"about"]) return YES;
    // A blob URL carries the origin of the page that made it.
    if ([scheme isEqualToString:@"blob"]) return [self allows:[NSURL URLWithString:url.resourceSpecifier]];
    std::string origin = std::string(scheme.UTF8String ?: "") + "://" + (url.host.UTF8String ?: "");
    if (url.port) origin += ":" + std::to_string(url.port.intValue);
    return std::find(origins.begin(), origins.end(), origin) != origins.end();
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decide {
    NSURL *url = action.request.URL;
    if (@available(macOS 11.3, iOS 14.5, *)) {
        // A link's download attribute saves what it points at instead of showing it: the page's own files, and data
        // the page holds as a data: URL.
        if (action.shouldPerformDownload && ([self allows:url] || [url.scheme.lowercaseString isEqualToString:@"data"])) {
            decide(WKNavigationActionPolicyDownload);
            return;
        }
    }
    // A link of target="_blank" asks for a window of its own, which the app opens none of.
    const BOOL isNewWindow = action.targetFrame == nil;
    if (!isNewWindow && ([self isApproved:url] || [self allows:url])) {
        decide(WKNavigationActionPolicyAllow);
        return;
    }
    const BOOL isUserInitiated = action.navigationType == WKNavigationTypeLinkActivated || action.navigationType == WKNavigationTypeFormSubmitted;
    const app::NavigationAnswer answer = [self allows:url] ? app::NavigationAnswer::refuse
                                                           : app::decideNavigation((__bridge const void *)webView, text(url.absoluteString), isNewWindow || action.targetFrame.isMainFrame,
                                                               isUserInitiated, isNewWindow);
    if (answer == app::NavigationAnswer::load && !isNewWindow) {
        decide(WKNavigationActionPolicyAllow);
        return;
    }
    decide(WKNavigationActionPolicyCancel);
    if (answer == app::NavigationAnswer::load) {
        approved = text(url.absoluteString);
        [webView loadRequest:action.request];
    }
    if (answer == app::NavigationAnswer::openOutside) openOutside(url);
}

// A server's certificate the system trusts loads as it would; page-navigation decides one it does not, and a user's name
// and password a server asks for.
- (void)webView:(WKWebView *)webView
    didReceiveAuthenticationChallenge:(NSURLAuthenticationChallenge *)challenge
                    completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))done {
    NSURLProtectionSpace *space = challenge.protectionSpace;
    NSString *method = space.authenticationMethod;
    void (^answer)(NSURLSessionAuthChallengeDisposition, NSURLCredential *) = [done copy];
    if ([method isEqualToString:NSURLAuthenticationMethodServerTrust]) {
        if (space.serverTrust) {
            [self evaluate:space answer:answer];
        } else {
            answer(NSURLSessionAuthChallengePerformDefaultHandling, nil);
        }
        return;
    }
    if (![@[ NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLAuthenticationMethodNTLM, NSURLAuthenticationMethodNegotiate ]
            containsObject:method]) {
        answer(NSURLSessionAuthChallengePerformDefaultHandling, nil);
        return;
    }
    // A cancel lets the request go on without the name, as WebKit does without this method, so the page gets what the
    // server answers to that.
    app::askHttpAuthentication(app::make<HttpAuthentication>(std::make_shared<app::StateOf<HttpAuthentication>>((__bridge const void *)webView, hostOf(space),
        text(space.realm), space.isProxy,
        [answer](std::optional<std::pair<std::string, std::string>> given) {
            NSURLCredential *credential = given ? [NSURLCredential credentialWithUser:[NSString stringWithUTF8String:given->first.c_str()] ?: @""
                                                                             password:[NSString stringWithUTF8String:given->second.c_str()] ?: @""
                                                                          persistence:NSURLCredentialPersistenceForSession]
                                                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                if (credential) {
                    answer(NSURLSessionAuthChallengeUseCredential, credential);
                } else {
                    answer(NSURLSessionAuthChallengeRejectProtectionSpace, nil);
                }
            });
        })));
}

// The system evaluates a server's certificate off the main thread, as it may fetch what it needs to over the network.
// One it does not trust goes on where page-navigation trusted it for the host before, and to page-navigation otherwise.
- (void)evaluate:(NSURLProtectionSpace *)space answer:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))answer {
    SecTrustRef trust = space.serverTrust;
    CFRetain(trust);
    __weak CBNavigationLock *weak = self;
    dispatch_queue_t queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
    dispatch_async(queue, ^{
        // The result comes on the queue the evaluation starts from.
        const OSStatus started = SecTrustEvaluateAsyncWithError(trust, queue, ^(SecTrustRef, bool isTrusted, CFErrorRef failure) {
            NSString *reason = failure ? CFBridgingRelease(CFErrorCopyDescription(failure)) : @"";
            dispatch_async(dispatch_get_main_queue(), ^{
                CBNavigationLock *lock = weak;
                if (isTrusted || !lock) {
                    answer(isTrusted ? NSURLSessionAuthChallengePerformDefaultHandling : NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
                } else {
                    [lock untrusted:trust space:space reason:reason answer:answer];
                }
                CFRelease(trust);
            });
        });
        if (started != errSecSuccess) {
            dispatch_async(dispatch_get_main_queue(), ^{
                answer(NSURLSessionAuthChallengePerformDefaultHandling, nil);
                CFRelease(trust);
            });
        }
    });
}

- (void)untrusted:(SecTrustRef)trust
            space:(NSURLProtectionSpace *)space
           reason:(NSString *)reason
           answer:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))answer {
    NSString *host = ns(hostOf(space));
    NSData *leaf = leafOf(trust);
    NSURLCredential *credential = [NSURLCredential credentialForTrust:trust];
    if (leaf && [trusted[host] containsObject:leaf]) {
        answer(NSURLSessionAuthChallengeUseCredential, credential);
        return;
    }
    __weak CBNavigationLock *weak = self;
    const std::string url = text(space.protocol) + "://" + hostOf(space);
    app::askCertificateError(app::make<CertificateError>(std::make_shared<app::StateOf<CertificateError>>((__bridge const void *)view, url, hostOf(space),
        text(reason),
        [answer, credential, host, leaf, weak](bool isTrusted) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (!isTrusted) {
                    answer(NSURLSessionAuthChallengeCancelAuthenticationChallenge, nil);
                    return;
                }
                [weak trust:leaf host:host];
                if (!isWebContentExempt()) {
                    std::fprintf(stderr,
                        "crossbind: the extension %s trusted the certificate of %s, which App Transport Security refuses all the same: an extension that "
                        "trusts certificates gives NSAppTransportSecurity: { NSAllowsArbitraryLoadsInWebContent: true } in its plist on macos and ios.\n",
                        app::holderOf("page-authentication").c_str(), host.UTF8String);
                }
                answer(NSURLSessionAuthChallengeUseCredential, credential);
            });
        })));
}

- (void)trust:(NSData *)leaf host:(NSString *)host {
    if (!leaf) return;
    if (!trusted) trusted = [NSMutableDictionary new];
    if (!trusted[host]) trusted[host] = [NSMutableSet new];
    [trusted[host] addObject:leaf];
}

- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation {
    // An approval no load in place took goes with the page it came from.
    approved.clear();
    newPage();
}

// A response the webview cannot show, such as a zip, downloads as it does in a browser.
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)response
                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decide {
    if (@available(macOS 11.3, iOS 14.5, *)) {
        if (!response.canShowMIMEType) {
            decide(WKNavigationResponsePolicyDownload);
            return;
        }
    }
    decide(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download
    API_AVAILABLE(macos(11.3), ios(14.5)) {
    [self save:download];
}

- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download
    API_AVAILABLE(macos(11.3), ios(14.5)) {
    [self save:download];
}

// A download holds its delegate weakly.
- (void)save:(WKDownload *)download API_AVAILABLE(macos(11.3), ios(14.5)) {
    if (!downloads) downloads = [CBDownloads new];
    download.delegate = downloads;
}

@end

namespace {
char lockKey;
}

void restrictNavigation(void *webView, std::vector<std::string> origins, std::function<void()> newPage) {
    WKWebView *view = (__bridge WKWebView *)webView;
    CBNavigationLock *lock = [CBNavigationLock new];
    lock->view = view;
    lock->origins = std::move(origins);
    lock->newPage = std::move(newPage);
    // The webview holds its navigation delegate weakly.
    objc_setAssociatedObject(view, &lockKey, lock, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    view.navigationDelegate = lock;
}

// CBNavigationLock, the webview's navigation delegate, hands its downloads to CBDownloads.
void takeDownloads(void *) {}

void openPageWindow(void *webView, void *navigationAction) {
    WKWebView *view = (__bridge WKWebView *)webView;
    WKNavigationAction *action = (__bridge WKNavigationAction *)navigationAction;
    CBNavigationLock *lock = objc_getAssociatedObject(view, &lockKey);
    NSURL *url = action.request.URL;
    const app::NavigationAnswer answer = !lock || [lock allows:url]
        ? app::NavigationAnswer::refuse
        : app::decideNavigation((__bridge const void *)view, text(url.absoluteString), true, action.navigationType == WKNavigationTypeLinkActivated, true);
    if (answer == app::NavigationAnswer::load) {
        lock->approved = text(url.absoluteString);
        [view loadRequest:action.request];
    }
    if (answer == app::NavigationAnswer::openOutside) openOutside(url);
}

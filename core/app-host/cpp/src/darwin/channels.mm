#import <WebKit/WebKit.h>

#include "platform.h"

#include <cstdio>
#include <memory>

namespace {

// Wraps the page's console and reports uncaught errors, in the main frame alone.
NSString *const CONSOLE_SCRIPT = @"(() => {"
    "const text = (args) => args.map((arg) => {"
    "  if (arg instanceof Error) return `${arg.message}\\n${arg.stack}`;"
    "  if (typeof arg === 'string') return arg;"
    "  try { return JSON.stringify(arg); } catch { return String(arg); }"
    "}).join(' ');"
    "const post = (level, args) => window.webkit.messageHandlers.crossbind_console.postMessage([level, text(args)]);"
    "for (const level of ['log', 'info', 'warn', 'error', 'debug']) {"
    "  const original = console[level].bind(console);"
    "  console[level] = (...args) => { post(level, args); original(...args); };"
    "}"
    "addEventListener('error', (event) => post('error', [event.error ?? event.message]));"
    "addEventListener('unhandledrejection', (event) => post('error', [event.reason]));"
    "})();";

void onMainThread(void (^block)(void)) {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

}  // namespace

@interface CBReplyChannel : NSObject <WKScriptMessageHandlerWithReply>
- (instancetype)initWithHandler:(MessageHandler)handler;
@end

@implementation CBReplyChannel {
    MessageHandler _handler;
}

- (instancetype)initWithHandler:(MessageHandler)handler {
    if ((self = [super init])) _handler = std::move(handler);
    return self;
}

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id, NSString *))replyHandler {
    NSString *body = [message.body isKindOfClass:[NSString class]] ? message.body : @"";
    WKSecurityOrigin *sender = message.frameInfo.securityOrigin;
    NSString *origin = [NSString stringWithFormat:@"%@://%@%@", sender.protocol, sender.host,
                                 sender.port ? [NSString stringWithFormat:@":%ld", static_cast<long>(sender.port)] : @""];
    void (^reply)(id, NSString *) = [replyHandler copy];
    _handler(std::string(origin.UTF8String ?: ""), std::string(body.UTF8String ?: ""), [reply](const std::string &text) {
        // The host answers from its JS thread, which has no autorelease pool of its own.
        @autoreleasepool {
            NSString *answer = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
            onMainThread(^{
                reply(answer, nil);
            });
        }
    });
}

@end

@interface CBConsole : NSObject <WKScriptMessageHandler>
@end

@implementation CBConsole

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    NSArray *entry = [message.body isKindOfClass:[NSArray class]] ? message.body : nil;
    if (entry.count != 2) return;
    NSString *level = [entry[0] description];
    std::FILE *out = [level isEqualToString:@"warn"] || [level isEqualToString:@"error"] ? stderr : stdout;
    std::fprintf(out, "%s\n", [entry[1] description].UTF8String);
    std::fflush(out);
}

@end

@interface CBSchemeHandler : NSObject <WKURLSchemeHandler>
- (instancetype)initWithHandler:(SchemeHandler)handler;
@end

@implementation CBSchemeHandler {
    SchemeHandler _handler;
    NSMutableSet *_stopped;
}

- (instancetype)initWithHandler:(SchemeHandler)handler {
    if ((self = [super init])) {
        _handler = std::move(handler);
        _stopped = [NSMutableSet set];
    }
    return self;
}

static std::vector<uint8_t> readBody(NSURLRequest *request) {
    std::vector<uint8_t> body;
    if (NSData *data = request.HTTPBody) {
        body.assign(static_cast<const uint8_t *>(data.bytes), static_cast<const uint8_t *>(data.bytes) + data.length);
        return body;
    }
    NSInputStream *stream = request.HTTPBodyStream;
    if (!stream) return body;
    [stream open];
    uint8_t chunk[65536];
    for (NSInteger read; (read = [stream read:chunk maxLength:sizeof chunk]) > 0;) {
        body.insert(body.end(), chunk, chunk + read);
    }
    [stream close];
    return body;
}

// A file's length of bytes goes in parts, read on a queue of their own, each handed to WebKit before the next is read,
// until the page stops the task.
static void sendFile(id<WKURLSchemeTask> task, NSHTTPURLResponse *response, NSString *path, unsigned long long length, NSMutableSet *stopped) {
    constexpr NSUInteger CHUNK_BYTES = 1 << 20;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:path];
        __block BOOL isDone = NO;
        __block unsigned long long left = length;
        // On the main thread, which alone touches stopped.
        BOOL (^isStopped)(void) = ^BOOL {
            if (![stopped containsObject:task]) return NO;
            [stopped removeObject:task];
            return YES;
        };
        dispatch_sync(dispatch_get_main_queue(), ^{
            isDone = isStopped();
            if (isDone) return;
            if (!file) {
                [task didFailWithError:[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadNoSuchFileError userInfo:nil]];
                isDone = YES;
                return;
            }
            [task didReceiveResponse:response];
        });
        while (!isDone) {
            @autoreleasepool {
                NSError *error = nil;
                NSData *chunk = left == 0 ? [NSData data] : [file readDataUpToLength:static_cast<NSUInteger>(MIN(left, CHUNK_BYTES)) error:&error];
                left -= chunk.length;
                dispatch_sync(dispatch_get_main_queue(), ^{
                    isDone = YES;
                    if (isStopped()) return;
                    if (!chunk) {
                        [task didFailWithError:error];
                    } else if (chunk.length == 0) {
                        [task didFinish];
                    } else {
                        [task didReceiveData:chunk];
                        isDone = NO;
                    }
                });
            }
        }
        [file closeFile];
    });
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSURLRequest *request = task.request;
    SchemeRequest incoming;
    incoming.method = request.HTTPMethod.UTF8String ?: "GET";
    incoming.path = [NSURLComponents componentsWithURL:request.URL resolvingAgainstBaseURL:NO].percentEncodedPath.UTF8String ?: "";
    incoming.query = request.URL.query.UTF8String ?: "";
    incoming.body = readBody(request);
    NSDictionary<NSString *, NSString *> *fields = request.allHTTPHeaderFields;
    for (NSString *name in fields) incoming.headers.emplace_back(name.UTF8String ?: "", fields[name].UTF8String ?: "");
    incoming.webView = (__bridge const void *)webView;

    id<WKURLSchemeTask> held = task;
    NSURL *url = request.URL;
    NSMutableSet *stopped = _stopped;
    _handler(std::move(incoming), [held, url, stopped](SchemeResponse response) {
        // A call's answer comes from the host's JS thread, which has no autorelease pool of its own.
        @autoreleasepool {
            const bool isFile = !response.file.empty();
            auto *bytes = new std::vector<uint8_t>(std::move(response.body));
            NSData *data = [[NSData alloc] initWithBytesNoCopy:bytes->data()
                                                        length:bytes->size()
                                                   deallocator:^(void *, NSUInteger) { delete bytes; }];
            const unsigned long long length = isFile ? response.fileLength : data.length;
            NSMutableDictionary *headers = [@{
                // A route's type that is no UTF-8 makes no string.
                @"Content-Type": [NSString stringWithUTF8String:response.mime.c_str()] ?: @"application/octet-stream",
                @"Content-Length": [NSString stringWithFormat:@"%llu", length],
            } mutableCopy];
            for (const auto &[name, value] : response.headers) {
                NSString *key = [NSString stringWithUTF8String:name.c_str()];
                if (key) headers[key] = [NSString stringWithUTF8String:value.c_str()];
            }
            NSHTTPURLResponse *http = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                  statusCode:response.status
                                                                 HTTPVersion:@"HTTP/1.1"
                                                                headerFields:headers];
            if (isFile) {
                sendFile(held, http, [NSString stringWithUTF8String:response.file.c_str()], length, stopped);
                return;
            }
            onMainThread(^{
                // The page may have dropped the request meanwhile; WebKit refuses answers to a stopped task.
                if ([stopped containsObject:held]) {
                    [stopped removeObject:held];
                    return;
                }
                [held didReceiveResponse:http];
                [held didReceiveData:data];
                [held didFinish];
            });
        }
    });
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {
    [_stopped addObject:task];
}

@end

void installReplyChannel(void *webView, const char *name, MessageHandler handler) {
    WKWebView *view = (__bridge WKWebView *)webView;
    CBReplyChannel *channel = [[CBReplyChannel alloc] initWithHandler:std::move(handler)];
    [view.configuration.userContentController addScriptMessageHandlerWithReply:channel
                                                                  contentWorld:WKContentWorld.pageWorld
                                                                          name:[NSString stringWithUTF8String:name]];
}

void forwardConsole(void *webView) {
    WKUserContentController *controller = ((__bridge WKWebView *)webView).configuration.userContentController;
    [controller addScriptMessageHandler:[CBConsole new] name:@"crossbind_console"];
    [controller addUserScript:[[WKUserScript alloc] initWithSource:CONSOLE_SCRIPT
                                                     injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                  forMainFrameOnly:YES]];
}

void addTopFrameScript(void *webView, const std::string &source) {
    WKUserContentController *controller = ((__bridge WKWebView *)webView).configuration.userContentController;
    [controller addUserScript:[[WKUserScript alloc] initWithSource:[NSString stringWithUTF8String:source.c_str()]
                                                     injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                  forMainFrameOnly:YES]];
}

void registerSchemeHandler(void *target, const char *scheme, SchemeHandler handler) {
    WKWebViewConfiguration *config = (__bridge WKWebViewConfiguration *)target;
    CBSchemeHandler *schemeHandler = [[CBSchemeHandler alloc] initWithHandler:std::move(handler)];
    [config setURLSchemeHandler:schemeHandler forURLScheme:[NSString stringWithUTF8String:scheme]];
}

// WebKit may suspend the page of a hidden window, as behind a locked screen or an iPad's in the background, while a call
// of the page waits for the host's answer, which then reaches it no more. iOS suspends an app in the background all the
// same.
void keepRunningWhenHidden(void *target) {
    if (@available(macOS 14.0, iOS 17.0, *)) {
        ((__bridge WKWebViewConfiguration *)target).preferences.inactiveSchedulingPolicy = WKInactiveSchedulingPolicyNone;
    }
}

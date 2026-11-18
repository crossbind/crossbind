// The fetch() of Apple's platforms: NSURLSession, ephemeral, without cookies, a cache or credentials, and a delegate that
// follows redirects within the URL's origin itself, as NSURLSession gives up after 16, and keeps the answer within its
// limits.
#import <Foundation/Foundation.h>

#include "host_core.h"

#include <algorithm>
#include <cctype>

namespace app = crossbind::app;

namespace {

std::string text(NSString *string) { return string.UTF8String ?: ""; }

std::string lower(std::string name) {
    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return name;
}

// Its scheme, host and port, a scheme's own port as that port.
BOOL isSameOrigin(NSURL *from, NSURL *to) {
    const auto port = [](NSURL *url) { return url.port ? url.port.integerValue : [url.scheme.lowercaseString isEqualToString:@"https"] ? 443 : 80; };
    return [from.scheme.lowercaseString isEqualToString:to.scheme.lowercaseString] && [from.host.lowercaseString isEqualToString:to.host.lowercaseString]
           && port(from) == port(to);
}

}  // namespace

// One fetch, the delegate of a session of its own, which holds it until its last task ends.
@interface CBFetch : NSObject <NSURLSessionDataDelegate> {
@public
    app::FetchDone done;
    std::optional<std::string> failure;
    std::string body;
    int redirects;
    NSURL *first;
    // A redirect within the first URL's origin, which the fetch asks for once the answer that named it has ended.
    NSURLRequest *next;
    NSURLSessionTask *task;
}
@end

@implementation CBFetch

// NSURLSession follows none: one elsewhere comes back as its 3xx.
- (void)URLSession:(NSURLSession *)session
                          task:(NSURLSessionTask *)task
    willPerformHTTPRedirection:(NSHTTPURLResponse *)response
                    newRequest:(NSURLRequest *)request
             completionHandler:(void (^)(NSURLRequest *))completion {
    if (isSameOrigin(first, request.URL)) {
        redirects += 1;
        if (redirects > app::MAX_FETCH_REDIRECTS) failure = app::redirectedTooOften();
        else next = request;
    }
    completion(nil);
}

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)task
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
    if (response.expectedContentLength > static_cast<long long>(app::MAX_FETCH_BYTES)) {
        failure = app::declaredTooLarge(static_cast<std::uint64_t>(response.expectedContentLength));
        completion(NSURLSessionResponseCancel);
        return;
    }
    completion(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    if (failure) return;
    if (body.size() + data.length > app::MAX_FETCH_BYTES) {
        failure = app::passedTheLimit();
        [task cancel];
        return;
    }
    [data enumerateByteRangesUsingBlock:^(const void *bytes, NSRange range, BOOL *) {
        self->body.append(static_cast<const char *>(bytes), range.length);
    }];
}

// A server's certificate goes as the system checks it; no other challenge gets a credential.
- (void)URLSession:(NSURLSession *)session
                   task:(NSURLSessionTask *)task
    didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
      completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completion {
    const BOOL isTrust = [challenge.protectionSpace.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust];
    completion(isTrust ? NSURLSessionAuthChallengePerformDefaultHandling : NSURLSessionAuthChallengeRejectProtectionSpace, nil);
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)ended didCompleteWithError:(NSError *)error {
    if (next && !failure && !error && done) {
        body.clear();
        task = [session dataTaskWithRequest:next];
        next = nil;
        [task resume];
        return;
    }
    [session finishTasksAndInvalidate];
    const app::FetchDone answer = std::move(done);
    done = nullptr;
    if (!answer) return;
    if (failure) {
        answer(failure, {});
        return;
    }
    if (error) {
        answer(error.code == NSURLErrorTimedOut ? app::tookTooLong() : text(error.localizedDescription), {});
        return;
    }
    NSHTTPURLResponse *response = (NSHTTPURLResponse *)ended.response;
    crossbind::FetchResponse fetched;
    fetched.status = static_cast<int>(response.statusCode);
    // NSURLSession takes the encoding off a body a server sent compressed all the same, whose length it then is not.
    NSString *encoding = [response valueForHTTPHeaderField:@"Content-Encoding"];
    const BOOL isDecoded = encoding.length > 0 && ![encoding.lowercaseString isEqualToString:@"identity"];
    for (NSString *name in response.allHeaderFields) {
        const std::string key = lower(text(name));
        if (isDecoded && (key == "content-encoding" || key == "content-length")) continue;
        fetched.headers.emplace_back(key, text(response.allHeaderFields[name]));
    }
    fetched.body = std::move(body);
    answer(std::nullopt, std::move(fetched));
}

@end

void crossbind::app::fetchOnPlatform(const std::string &method, const std::string &url, const crossbind::Request::Headers &headers, FetchDone done) {
    @autoreleasepool {
        NSURL *address = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
        if (!address) {
            done("crossbind: fetch() cannot read the URL " + url, {});
            return;
        }
        NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        configuration.HTTPCookieStorage = nil;
        configuration.HTTPShouldSetCookies = NO;
        configuration.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyNever;
        configuration.URLCache = nil;
        configuration.URLCredentialStorage = nil;
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        configuration.timeoutIntervalForRequest = FETCH_SECONDS;
        configuration.timeoutIntervalForResource = FETCH_SECONDS;
        CBFetch *fetch = [CBFetch new];
        fetch->done = std::move(done);
        fetch->first = address;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration delegate:fetch delegateQueue:nil];
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:address];
        request.HTTPMethod = [NSString stringWithUTF8String:method.c_str()];
        for (const auto &[name, value] : headers) {
            [request setValue:[NSString stringWithUTF8String:value.c_str()] forHTTPHeaderField:[NSString stringWithUTF8String:name.c_str()]];
        }
        [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
        fetch->task = [session dataTaskWithRequest:request];
        [fetch->task resume];
        // Each task has its own time, and the redirects followed add theirs: the fetch has FETCH_SECONDS in all. The
        // session's queue runs it, as it runs the delegate.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(FETCH_SECONDS) * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            [session.delegateQueue addOperationWithBlock:^{
                if (!fetch->done || fetch->failure) return;
                fetch->failure = app::tookTooLong();
                [fetch->task cancel];
            }];
        });
    }
}

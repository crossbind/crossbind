// The host's page-location: a macOS page's navigator.geolocation, to which WKWebView gives no position there, answered
// from CoreLocation as page-permissions lets the page have it. The build gives it to an app whose app.permissions lists
// the location, with the reason CoreLocation asks the app's user with.
#import <CoreLocation/CoreLocation.h>
#import <WebKit/WebKit.h>

#include "crossbind/extension.h"

#include <cmath>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace {

using Reply = std::function<void(const std::string &)>;

// How long the host holds an ask before it answers that it has no position yet, and the page asks again: an ask of a
// page that went away is answered too, as WebKit wants every reply given.
constexpr NSTimeInterval ASK_HELD = 5;

// navigator.geolocation in the top frame, which asks the host until it has a position or an error the API's codes name.
// The host answers a first ask at once and holds the next, and a timeout counts from once the system's question has
// been answered; a watch asks again after each position, and a second after an error, until denied.
NSString *const LOCATION_SCRIPT = @"(() => {"
    "const ask = (message) => window.webkit.messageHandlers.crossbind_location.postMessage(JSON.stringify(message)).then(JSON.parse);"
    "const failure = (code, message) => ({ code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });"
    "const ageOf = (options) => Math.max(0, Math.min(Number(options?.maximumAge) || 0, Number.MAX_SAFE_INTEGER));"
    "const timeoutOf = (options) => (Number.isFinite(options?.timeout) ? Math.max(0, options.timeout) : undefined);"
    "const watches = new Set();"
    "let nextWatch = 1;"
    "const geolocation = {"
    "  getCurrentPosition(success, error, options) {"
    "    let isDone = false;"
    "    let timer;"
    "    const done = (callback, value) => { if (!isDone) { isDone = true; clearTimeout(timer); callback?.(value); } };"
    "    const next = (wait) => ask({ wait, highAccuracy: Boolean(options?.enableHighAccuracy), maximumAge: ageOf(options) }).then((reply) => {"
    "      if (isDone) return;"
    "      if (reply.coords) return done(success, reply);"
    "      if (reply.error) return done(error, failure(reply.error, reply.message));"
    "      if (!reply.asking && timer === undefined && timeoutOf(options) !== undefined) {"
    "        timer = setTimeout(() => done(error, failure(3, 'Timeout expired')), timeoutOf(options));"
    "      }"
    "      next(true);"
    "    });"
    "    next(false);"
    "  },"
    "  watchPosition(success, error, options) {"
    "    const id = nextWatch++;"
    "    let maximumAge = ageOf(options);"
    "    let timer;"
    "    const countDown = () => {"
    "      clearTimeout(timer);"
    "      if (timeoutOf(options) !== undefined) timer = setTimeout(() => watches.has(id) && error?.(failure(3, 'Timeout expired')), timeoutOf(options));"
    "    };"
    "    const next = (wait) => ask({ wait, highAccuracy: Boolean(options?.enableHighAccuracy), maximumAge }).then((reply) => {"
    "      if (!watches.has(id)) return clearTimeout(timer);"
    "      try {"
    "        if (reply.coords) {"
    "          maximumAge = 0;"
    "          countDown();"
    "          success(reply);"
    "        } else if (reply.error) {"
    "          error?.(failure(reply.error, reply.message));"
    "        } else if (!reply.asking && timer === undefined) {"
    "          countDown();"
    "        }"
    "      } finally {"
    "        if (reply.error === 1) {"
    "          watches.delete(id);"
    "          clearTimeout(timer);"
    "        } else if (watches.has(id)) {"
    "          setTimeout(() => watches.has(id) && next(true), reply.error ? 1000 : 0);"
    "        }"
    "      }"
    "    });"
    "    watches.add(id);"
    "    next(false);"
    "    return id;"
    "  },"
    "  clearWatch(id) {"
    "    watches.delete(id);"
    "  },"
    "};"
    "Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, enumerable: true, get: () => geolocation });"
    "})();";

std::string jsonOf(NSDictionary *object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    return data ? std::string(static_cast<const char *>(data.bytes), data.length) : "{\"error\":2}";
}

std::string failureOf(int code, NSString *message) { return jsonOf(@{@"error" : @(code), @"message" : message ? message : @""}); }

// The answer while the host has no position, which says whether the system still asks the app's user.
std::string noPosition(CLAuthorizationStatus status) { return status == kCLAuthorizationStatusNotDetermined ? "{\"asking\":true}" : "{}"; }

// A number the page sent, or 0 for anything else.
double numberIn(NSDictionary *ask, NSString *key) {
    id value = ask[key];
    return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0;
}

id known(double value, bool isKnown) { return isKnown ? @(value) : NSNull.null; }

// An origin as the page's scripts name it, as "crossbind://app" or "http://localhost:5173".
std::string originOf(WKSecurityOrigin *origin) {
    std::string text = std::string(origin.protocol.UTF8String ?: "") + "://" + std::string(origin.host.UTF8String ?: "");
    if (origin.port != 0) text += ":" + std::to_string(origin.port);
    return text;
}

std::string positionOf(CLLocation *location) {
    return jsonOf(@{
        @"coords" : @{
            @"latitude" : @(location.coordinate.latitude),
            @"longitude" : @(location.coordinate.longitude),
            @"accuracy" : @(location.horizontalAccuracy),
            @"altitude" : known(location.altitude, location.verticalAccuracy >= 0),
            @"altitudeAccuracy" : known(location.verticalAccuracy, location.verticalAccuracy >= 0),
            @"heading" : known(location.course, location.course >= 0),
            @"speed" : known(location.speed, location.speed >= 0),
        },
        @"timestamp" : @(std::floor(location.timestamp.timeIntervalSince1970 * 1000)),
    });
}

// An ask for a position no older than maximumAge milliseconds before the ask came.
struct Ask {
    double maximumAge;
    NSDate *since;
    Reply reply;
};

// Gives the asks isDue picks the answer, and keeps the others.
template <typename IsDue>
void answer(std::vector<Ask> &asks, const std::string &text, IsDue isDue) {
    std::erase_if(asks, [&](const Ask &ask) {
        if (!isDue(ask)) return false;
        ask.reply(text);
        return true;
    });
}

bool always(const Ask &) { return true; }

}  // namespace

// The positions CoreLocation gives the app, which asks its user first, with app.permissions.location's reason.
@interface CBLocation : NSObject <CLLocationManagerDelegate, WKScriptMessageHandlerWithReply>
@end

@implementation CBLocation {
    CLLocationManager *_manager;
    std::vector<Ask> _asks;
    // Ticks while the page asks, answering the asks held too long, and stops CoreLocation once none came for a while.
    NSTimer *_clock;
    NSDate *_lastAsk;
    // Whether page-permissions lets the page have the location, which the host asks it once in the app's run, and the
    // asks that wait for its answer.
    std::optional<bool> _isAllowed;
    std::vector<std::pair<NSDictionary *, Reply>> _undecided;
}

- (instancetype)init {
    if ((self = [super init])) {
        _manager = [CLLocationManager new];
        _manager.delegate = self;
        _manager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
    }
    return self;
}

// Only the top frame, which the navigation rule keeps to the app's origins, learns where the app's user is.
- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id, NSString *))replyHandler {
    void (^respond)(id, NSString *) = [replyHandler copy];
    Reply reply = [respond](const std::string &text) { respond([NSString stringWithUTF8String:text.c_str()], nil); };
    if (!message.frameInfo.isMainFrame) {
        reply(failureOf(1, @"crossbind: a frame inside the page has no location"));
        return;
    }
    NSString *body = [message.body isKindOfClass:NSString.class] ? message.body : @"";
    id ask = [NSJSONSerialization JSONObjectWithData:[body dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES] options:0 error:nil];
    [self decide:[ask isKindOfClass:NSDictionary.class] ? ask : @{} origin:originOf(message.frameInfo.securityOrigin) reply:std::move(reply)];
}

// The page has a position once page-permissions allows it, which a watch would otherwise ask after each position;
// without that extension the page has none, as WebKit gives a macOS page none of its own.
- (void)decide:(NSDictionary *)ask origin:(std::string)origin reply:(Reply)reply {
    if (_isAllowed) {
        if (*_isAllowed) [self ask:ask reply:std::move(reply)];
        else reply(failureOf(1, @"User denied Geolocation"));
        return;
    }
    _undecided.emplace_back(ask, std::move(reply));
    if (_undecided.size() > 1) return;
    crossbind::askPagePermission({"location"}, std::move(origin), [self](bool isAllowed) { [self decided:isAllowed]; });
}

- (void)decided:(bool)isAllowed {
    _isAllowed = isAllowed;
    for (auto &[ask, reply] : std::exchange(_undecided, {})) {
        if (isAllowed) [self ask:ask reply:std::move(reply)];
        else reply(failureOf(1, @"User denied Geolocation"));
    }
}

- (void)ask:(NSDictionary *)ask reply:(Reply)reply {
    const CLAuthorizationStatus status = _manager.authorizationStatus;
    if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) {
        reply(failureOf(1, @"User denied Geolocation"));
        return;
    }
    const double maximumAge = numberIn(ask, @"maximumAge");
    if (status == kCLAuthorizationStatusNotDetermined) {
        [_manager requestWhenInUseAuthorization];
    } else {
        CLLocation *last = _manager.location;
        if (last && -last.timestamp.timeIntervalSinceNow * 1000 <= maximumAge) {
            reply(positionOf(last));
            return;
        }
        if (numberIn(ask, @"highAccuracy")) _manager.desiredAccuracy = kCLLocationAccuracyBest;
        [_manager startUpdatingLocation];
    }
    _lastAsk = [NSDate date];
    if (!_clock) _clock = [NSTimer scheduledTimerWithTimeInterval:1 target:self selector:@selector(tick) userInfo:nil repeats:YES];
    if (numberIn(ask, @"wait")) {
        _asks.push_back({maximumAge, _lastAsk, std::move(reply)});
    } else {
        reply(noPosition(status));
    }
}

- (void)tick {
    NSDate *now = [NSDate date];
    // A page whose ask this tick answers asks again at once, so CoreLocation stops only after a tick that held none.
    const bool isIdle = _asks.empty();
    answer(_asks, noPosition(_manager.authorizationStatus), [now](const Ask &ask) { return [now timeIntervalSinceDate:ask.since] >= ASK_HELD; });
    if (isIdle && [now timeIntervalSinceDate:_lastAsk] >= ASK_HELD) [self rest];
}

// Nothing asks: CoreLocation stops looking.
- (void)rest {
    [_clock invalidate];
    _clock = nil;
    [_manager stopUpdatingLocation];
    _manager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
    switch (manager.authorizationStatus) {
    case kCLAuthorizationStatusNotDetermined:
        return;
    case kCLAuthorizationStatusDenied:
    case kCLAuthorizationStatusRestricted:
        answer(_asks, failureOf(1, @"User denied Geolocation"), always);
        [self rest];
        return;
    default:
        // The page's timeout starts now, and its next ask starts CoreLocation.
        answer(_asks, "{}", always);
    }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
    CLLocation *location = locations.lastObject;
    // CoreLocation may hand over an old position first.
    answer(_asks, positionOf(location), [location](const Ask &ask) {
        return [location.timestamp timeIntervalSinceDate:ask.since] * 1000 >= -ask.maximumAge;
    });
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    // CoreLocation has no position yet and goes on looking; the page's timeout says how long to wait.
    if (error.code == kCLErrorLocationUnknown) return;
    answer(_asks, failureOf(error.code == kCLErrorDenied ? 1 : 2, error.localizedDescription), always);
    [self rest];
}

@end

// The page's navigator.geolocation and the handler of its asks join the webview as the window opens, before its page
// loads.
void crossbind_extension_page_location(crossbind::Registry &registry) {
    registry.onWindow([] {
        static CBLocation *location = [CBLocation new];
        WKUserContentController *contents = ((__bridge WKWebView *)crossbind::appWebView()).configuration.userContentController;
        [contents addUserScript:[[WKUserScript alloc] initWithSource:LOCATION_SCRIPT
                                                       injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                    forMainFrameOnly:YES]];
        [contents addScriptMessageHandlerWithReply:location contentWorld:WKContentWorld.pageWorld name:@"crossbind_location"];
    });
}

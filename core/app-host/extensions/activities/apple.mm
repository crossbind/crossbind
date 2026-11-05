// The user activities of app.activityTypes, the app's own, whose types the build gives this extension: the page hears
// of each the system continues the app with as the held event user-activity, and makes one current, for its user's other
// devices to continue, with crossbind/app's app.setUserActivity(), which takes those types alone.
#import <Foundation/Foundation.h>

#include "crossbind/app.h"
#include "crossbind/extension.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using crossbind::Value;

// The activity the page made current, which stays current as long as it lives.
NSUserActivity *current;

NSString *stringOf(const std::string &text) {
    NSString *string = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
    if (!string) throw std::invalid_argument("crossbind: app.setUserActivity takes text of UTF-8 alone");
    return string;
}

// A JSON value or bytes as a property list's, which a user activity's userInfo holds.
id plistOf(const Value &value) {
    if (value.isBool()) return @(value.asBool());
    if (value.isNumber()) return @(value.asNumber());
    if (value.isString()) return stringOf(value.asString());
    if (value.isBytes()) return [NSData dataWithBytes:value.asBytes().data() length:value.asBytes().size()];
    if (value.isArray()) {
        NSMutableArray *items = [NSMutableArray array];
        for (const Value &item : value.asArray()) [items addObject:plistOf(item)];
        return items;
    }
    if (value.isObject()) {
        NSMutableDictionary *members = [NSMutableDictionary dictionary];
        for (const auto &[key, member] : value.asObject()) members[stringOf(key)] = plistOf(member);
        return members;
    }
    return NSNull.null;
}

}  // namespace

void crossbind_extension_activities(crossbind::Registry &registry) {
    using crossbind::Call;
    // JSON has no bytes, which another app's activity may hold: the host tells why the page hears nothing of one.
    registry.onUserActivity([](const crossbind::UserActivity &activity) {
        Value::Object event{{"type", activity.type}, {"userInfo", activity.userInfo}};
        if (!activity.webpageUrl.empty()) event.emplace_back("webpageUrl", activity.webpageUrl);
        crossbind::app::holdEvent("user-activity", Value(std::move(event)).json());
        return true;
    });
    std::vector<std::string> types;
    for (const Value &type : registry.options()["types"].asArray()) types.push_back(type.asString());
    // An activity, or none without a type.
    registry.function("activities.set", [types](Call call) {
        @autoreleasepool {
            const Value &options = call.options();
            NSString *type = nil;
            NSDictionary *userInfo = nil;
            NSURL *page = nil;
            if (!options["type"].isNull()) {
                const std::string &name = options["type"].asString();
                if (std::find(types.begin(), types.end(), name) == types.end()) {
                    throw std::invalid_argument("crossbind: app.setUserActivity takes a type app.activityTypes in crossbind.config.js lists; " + name + " is none");
                }
                type = stringOf(name);
                const Value &info = options["userInfo"];
                if (!info.isNull() && !info.isObject()) throw std::invalid_argument("crossbind: app.setUserActivity's userInfo is no object");
                userInfo = info.isNull() ? @{} : plistOf(info);
                const std::string address = options["webpageUrl"].asString("");
                if (!address.empty()) {
                    page = [NSURL URLWithString:stringOf(address)];
                    // NSUserActivity takes an http or https page alone, and throws at another.
                    NSString *scheme = page.scheme.lowercaseString;
                    if (![scheme isEqualToString:@"https"] && ![scheme isEqualToString:@"http"]) {
                        throw std::invalid_argument("crossbind: app.setUserActivity's webpageUrl is no http or https address");
                    }
                }
            }
            crossbind::onMainThread([call, type, userInfo, page] {
                [current invalidate];
                current = nil;
                if (type) {
                    current = [[NSUserActivity alloc] initWithActivityType:type];
                    current.userInfo = userInfo;
                    current.webpageURL = page;
                    [current becomeCurrent];
                }
                call.resolve();
            });
        }
    });
}

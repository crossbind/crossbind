// iOS hands a running app a link of a site its association names as a user activity of the web: the hook hands the
// scene's delegate one, as iOS does, where xcrun simctl openurl stops at SpringBoard's question to its user. And the
// alert up, as its user reads it, and its button pressed: the run's way to the preview extension's question on iOS,
// where no public way presses an alert's button and an alert's views are no elements of accessibility until an
// assistive technology runs. The press dismisses the alert, then runs the action's own handler, as a tap on it does,
// through UIAlertAction's handler key, which the fixture alone reads.
#include "crossbind/extension.h"

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

namespace {

using crossbind::Call;
using crossbind::Value;

std::string textOf(NSString *text) { return text.UTF8String ?: ""; }

// The preview's pill window, on the app window's scene above its alerts, while it shows.
UIWindow *pillWindow() {
    UIWindow *app = (__bridge UIWindow *)crossbind::appWindow();
    for (UIWindow *each in app.windowScene.windows) {
        if (each.windowLevel == UIWindowLevelAlert + 1 && !each.hidden) return each;
    }
    return nil;
}

UIViewController *topOf(UIWindow *window) {
    UIViewController *top = window.rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    return top;
}

// The top alert, of the pill's window first, which the preview's own alerts come from, and the window it is in.
UIAlertController *alertUp(std::string *in = nullptr) {
    for (UIWindow *window : {pillWindow(), (__bridge UIWindow *)crossbind::appWindow()}) {
        UIViewController *top = window ? topOf(window) : nil;
        if (![top isKindOfClass:UIAlertController.class]) continue;
        if (in) *in = window == (__bridge UIWindow *)crossbind::appWindow() ? "app" : "pill";
        return (UIAlertController *)top;
    }
    return nil;
}

UIButton *pillOf(UIWindow *window) {
    for (UIView *each in window.rootViewController.view.subviews) {
        if ([each isKindOfClass:UIButton.class]) return (UIButton *)each;
    }
    return nil;
}

}  // namespace

// What the alert up shows, or null: its title and message, its actions and the one Return presses.
void questionUp(Call call) {
    crossbind::onMainThread([call] {
        std::string in;
        UIAlertController *alert = alertUp(&in);
        if (!alert) {
            call.resolve();
            return;
        }
        Value::Array titles;
        for (UIAlertAction *action in alert.actions) titles.emplace_back(textOf(action.title));
        const Value preferred = alert.preferredAction ? Value(textOf(alert.preferredAction.title)) : Value();
        call.resolve(Value::Object{{"texts", Value::Array{textOf(alert.title), textOf(alert.message)}}, {"buttons", titles}, {"preferred", preferred}, {"focused", Value()},
            {"window", in}});
    });
}

// An alert's action run as a tap on it runs it: the alert dismissed, then the action's own handler.
std::optional<std::string> pressAction(UIAlertController *alert, const std::string &button, std::function<void()> then) {
    UIAlertAction *pressed = nil;
    for (UIAlertAction *action in alert.actions) {
        if (textOf(action.title) == button) pressed = action;
    }
    if (!pressed) return "crossbind e2e: the alert has no action " + button;
    id handler = nil;
    @try {
        handler = [pressed valueForKey:@"handler"];
    } @catch (NSException *exception) {
        return "crossbind e2e: UIAlertAction has no handler key: " + textOf(exception.reason);
    }
    // A Cancel with no handler of its own dismisses its alert alone, as a tap on it does.
    if (!handler && pressed.style != UIAlertActionStyleCancel) return "crossbind e2e: the action " + button + " has no handler";
    void (^run)(UIAlertAction *) = handler;
    [alert.presentingViewController dismissViewControllerAnimated:NO
                                                       completion:^{
                                                           if (run) run(pressed);
                                                           then();
                                                       }];
    return std::nullopt;
}

// The top alert, known by its words, the project's name among them, pressed at the action of this title.
void pressInQuestion(Call call) {
    const std::string button = call.options()["button"].asString();
    const std::string words = call.options()["words"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    const auto press = [button, words](std::function<void(std::optional<std::string>)> done) {
        UIAlertController *alert = alertUp();
        if (!alert || textOf(alert.title) != words) return done("crossbind e2e: no alert up asks " + words);
        const std::optional<std::string> failure = pressAction(alert, button, [done] { done(std::nullopt); });
        if (failure) done(failure);
    };
    if (ms > 0) {
        call.resolve();
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            press([](std::optional<std::string>) {});
        });
        return;
    }
    crossbind::onMainThread([call, press] {
        press([call](std::optional<std::string> failure) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
}

void handLinkAsIos(crossbind::Call call) {
    const std::string url = call.options()["url"].asString();
    crossbind::onMainThread([call, url] {
        UIWindowScene *scene = nil;
        for (UIScene *each in UIApplication.sharedApplication.connectedScenes) {
            if ([each isKindOfClass:UIWindowScene.class]) scene = (UIWindowScene *)each;
        }
        id<UISceneDelegate> delegate = scene.delegate;
        if (![delegate respondsToSelector:@selector(scene:continueUserActivity:)]) {
            call.reject("crossbind e2e: no scene of the app's continues a user activity");
            return;
        }
        NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:NSUserActivityTypeBrowsingWeb];
        activity.webpageURL = [NSURL URLWithString:@(url.c_str())];
        [delegate scene:scene continueUserActivity:activity];
        call.resolve();
    });
}

// The preview's pill as its user sees it on iOS: its window above the app's, its words and where it is on the screen,
// and its menu while it is open; the pill tapped as its own action, and an item of its menu pressed as a tap on it
// runs, now or once ms passed, as when a page's own dialog will hold the page.
Value indicatorState() {
    UIWindow *window = pillWindow();
    UIButton *pill = window ? pillOf(window) : nil;
    if (!pill) return Value::Object{{"up", false}};
    const CGRect frame = [pill convertRect:pill.bounds toCoordinateSpace:window.screen.coordinateSpace];
    const CGFloat scale = window.screen.scale;
    Value::Object state{{"up", true}, {"words", textOf(pill.configuration.title ?: pill.currentTitle)}, {"label", textOf(pill.accessibilityLabel)},
        {"level", static_cast<double>(window.windowLevel)}, {"appLevel", static_cast<double>(((__bridge UIWindow *)crossbind::appWindow()).windowLevel)},
        {"frame", Value::Array{frame.origin.x * scale, frame.origin.y * scale, frame.size.width * scale, frame.size.height * scale}}};
    UIViewController *top = topOf(window);
    if ([top isKindOfClass:UIAlertController.class] && ((UIAlertController *)top).preferredStyle == UIAlertControllerStyleActionSheet) {
        UIAlertController *menu = (UIAlertController *)top;
        Value::Array actions;
        for (UIAlertAction *action in menu.actions) actions.emplace_back(textOf(action.title));
        state.emplace_back("menu", Value::Object{{"title", textOf(menu.title)}, {"message", textOf(menu.message)}, {"items", actions}});
    }
    return Value(std::move(state));
}

void indicatorUp(Call call) {
    crossbind::onMainThread([call] { call.resolve(indicatorState()); });
}

void pressIndicator(Call call) {
    const std::string item = call.options()["item"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    auto press = [item](std::function<void(std::optional<std::string>)> done) {
        UIWindow *window = pillWindow();
        UIButton *pill = window ? pillOf(window) : nil;
        if (!pill) return done("crossbind e2e: no pill is up");
        // The pill's menu where it shows already; else a tap at the pill's middle, which reaches the pill alone where
        // nothing the pill's window presents covers it.
        const bool isOpen = [topOf(window) isKindOfClass:UIAlertController.class] && ((UIAlertController *)topOf(window)).preferredStyle == UIAlertControllerStyleActionSheet;
        if (!isOpen) {
            const CGPoint middle = [pill convertPoint:CGPointMake(CGRectGetMidX(pill.bounds), CGRectGetMidY(pill.bounds)) toView:window];
            UIView *hit = [window hitTest:middle withEvent:nil];
            if (![hit isDescendantOfView:pill]) return done("crossbind e2e: the pill is covered by " + textOf(NSStringFromClass(hit.class)));
            [pill sendActionsForControlEvents:UIControlEventTouchUpInside];
        }
        if (item == "menu") return done(std::nullopt);
        // The menu shows once its presentation ends.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (isOpen ? 0 : 600) * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            UIViewController *top = topOf(window);
            if (![top isKindOfClass:UIAlertController.class]) return done("crossbind e2e: the pill opened no menu");
            const std::optional<std::string> failure = pressAction((UIAlertController *)top, item, [] {});
            done(failure);
        });
    };
    if (ms > 0) {
        call.resolve();
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            press([](std::optional<std::string>) {});
        });
        return;
    }
    crossbind::onMainThread([call, press] {
        press([call](std::optional<std::string> failure) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
}

void gesture(Call call) {
    NSString *script = @(call.options()["script"].asString().c_str());
    crossbind::onMainThread([call, script] {
        [(__bridge WKWebView *)crossbind::appWebView() evaluateJavaScript:script completionHandler:^(id, NSError *error) {
            if (error) call.reject(textOf(error.localizedDescription));
            else call.resolve();
        }];
    });
}

// The indicator and what the app shows over the page noted at the run's endpoint once ms passed, as when the page's own
// dialog will hold the page; a file input of the page clicked as its user's click, the picker it brings up read, and
// closed as its user's Cancel closes it.
void noteLater(const std::string &endpoint, Call call) {
    const double ms = call.options()["ms"].asNumber();
    const std::string tag = call.options()["tag"].asString();
    call.resolve();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        Value::Array alerts;
        for (UIWindow *window : {pillWindow(), (__bridge UIWindow *)crossbind::appWindow()}) {
            for (UIViewController *shown = window.rootViewController.presentedViewController; shown; shown = shown.presentedViewController) {
                if (![shown isKindOfClass:UIAlertController.class]) continue;
                alerts.emplace_back(Value::Object{{"window", window == pillWindow() ? "pill" : "app"}, {"title", textOf(((UIAlertController *)shown).title)}});
            }
        }
        const Value noted = Value::Object{{"event", "later"}, {"tag", tag}, {"indicator", indicatorState()}, {"alerts", alerts}};
        crossbind::fetch("POST", endpoint + "/report?role=app", {{"Content-Type", "application/json"}}, noted.json(), [](std::optional<std::string>, crossbind::FetchResponse) {});
    });
}

// WebKit's own picker for a file input, which it presents over the app's window.
void pickerUp(Call call) {
    crossbind::onMainThread([call] {
        UIViewController *top = topOf((__bridge UIWindow *)crossbind::appWindow());
        const bool isPicker = top != ((__bridge UIWindow *)crossbind::appWindow()).rootViewController && ![top isKindOfClass:UIAlertController.class];
        call.resolve(isPicker ? Value(textOf(NSStringFromClass(top.class))) : Value());
    });
}

void dismissPicker(Call call) {
    crossbind::onMainThread([call] {
        UIViewController *top = topOf((__bridge UIWindow *)crossbind::appWindow());
        [top.presentingViewController dismissViewControllerAnimated:NO completion:^{ call.resolve(); }];
    });
}

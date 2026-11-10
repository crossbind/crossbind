// An iOS app: a window for each of its scenes, whose WKWebView page reaches a crossbind module running in Hermes, as on
// macOS. The page comes from crossbind://app/, or in a debug app the dev server opens, from the URL CROSSBIND_APP_URL
// names; another window's from the path windows.open() gave it.
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#include "app.h"
#include "crossbind_app.h"
#include "darwin/values.h"
#include "ios/scenes.h"

#include <cmath>
#include <cstdint>

namespace {

namespace app = crossbind::app;

app::Core *core;
const char *devUrl;

#ifdef CROSSBIND_APP_BACKGROUND_COLOR
// The relative luminance of a color that black and white contrast with as much.
constexpr double EVEN_CONTRAST = 0.179;

UIColor *colorOf(std::uint32_t color) {
    return [UIColor colorWithRed:((color >> 16) & 0xff) / 255.0 green:((color >> 8) & 0xff) / 255.0 blue:(color & 0xff) / 255.0 alpha:1];
}

bool isDark(std::uint32_t color) {
    const auto linear = [](std::uint32_t channel) {
        const double value = (channel & 0xff) / 255.0;
        return value <= 0.04045 ? value / 12.92 : std::pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(color >> 16) + 0.7152 * linear(color >> 8) + 0.0722 * linear(color) < EVEN_CONTRAST;
}

// app.window.backgroundColor, the dark one of its two while the system is dark.
std::uint32_t backgroundOf(UITraitCollection *traits) {
#ifdef CROSSBIND_APP_BACKGROUND_COLOR_DARK
    if (traits.userInterfaceStyle == UIUserInterfaceStyleDark) return CROSSBIND_APP_BACKGROUND_COLOR_DARK;
#endif
    return CROSSBIND_APP_BACKGROUND_COLOR;
}

// The color, which follows the system's appearance as it changes.
UIColor *backgroundColor() {
    return [UIColor colorWithDynamicProvider:^UIColor *(UITraitCollection *traits) { return colorOf(backgroundOf(traits)); }];
}
#endif

}  // namespace

// The status bar lies over the page: on app.window.backgroundColor, light on a dark color and dark on a light one, the
// color of the system's appearance as it changes.
@interface CBPageController : UIViewController
@end

@implementation CBPageController

#ifdef CROSSBIND_APP_BACKGROUND_COLOR
- (UIStatusBarStyle)preferredStatusBarStyle {
    return isDark(backgroundOf(self.traitCollection)) ? UIStatusBarStyleLightContent : UIStatusBarStyleDarkContent;
}
#endif

#ifdef CROSSBIND_APP_BACKGROUND_COLOR_DARK
- (void)traitCollectionDidChange:(UITraitCollection *)previous {
    [super traitCollectionDidChange:previous];
    if ([self.traitCollection hasDifferentColorAppearanceComparedToTraitCollection:previous]) [self setNeedsStatusBarAppearanceUpdate];
}
#endif

@end

@interface CBSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation CBSceneDelegate {
    uint64_t windowId;
}

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    const SceneWindow opening = sceneWindowOf(session, options);
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    registerSchemeHandler((__bridge void *)configuration, "crossbind", [](SchemeRequest request, SchemeRespond respond) {
        core->serve(std::move(request), std::move(respond));
    });
    keepRunningWhenHidden((__bridge void *)configuration);
    WKWebView *webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration];
#ifdef CROSSBIND_APP_BACKGROUND_COLOR
    // app.window.backgroundColor, which the launch screen shows as well, until the page paints and behind it.
    webView.opaque = NO;
    webView.backgroundColor = backgroundColor();
    webView.scrollView.backgroundColor = webView.backgroundColor;
#endif
#ifdef CROSSBIND_APP_DEV
    if (@available(iOS 16.4, *)) webView.inspectable = YES;
#endif
    UIViewController *controller = [CBPageController new];
    controller.view = webView;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController = controller;
    listenForActivity();
    [self.window makeKeyAndVisible];
    // A scene that connects again, in a process that outlived the last one, is a window of its own, with a page of its
    // own: a link that launched the scene waits for the page to ask.
    windowId = app::windowOpened((__bridge void *)self.window, (__bridge void *)webView, opening.name);
    sceneOpened((UIWindowScene *)scene, windowId, opening);
    const std::string url = app::attach(*core, (__bridge void *)webView, devUrl, windowId);
    const std::string page = opening.path == "/" ? url : app::originOf(url) + opening.path;
    [webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@(page.c_str())]]];
    // A link or a document that launched the app reaches the owner of its scheme or type: the page once it asks for it,
    // or an extension; so do a site's link, a user activity and a quick action's tap.
    [self scene:scene openURLContexts:options.URLContexts];
    for (NSUserActivity *activity in options.userActivities) {
        if (!isWindowActivity(activity)) [self scene:scene continueUserActivity:activity];
    }
    if (options.shortcutItem) app::shortcutItemTapped(options.shortcutItem.type.UTF8String ?: "");
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)contexts {
    std::vector<std::string> paths;
    for (UIOpenURLContext *context in contexts) {
        NSURL *url = context.URL;
        if (!url.isFileURL) {
            app::openedUrl(url.absoluteString.UTF8String);
            continue;
        }
        // A document opens where it is, which the app may read and write as long as it runs; one iOS copied into the
        // app's Inbox is the app's own, and asks for no access.
        [url startAccessingSecurityScopedResource];
        if (url.path) paths.push_back(url.path.UTF8String);
    }
    if (!paths.empty()) app::openedFiles(paths);
}

// A link of app.links' sites, which iOS hands the app once the site's apple-app-site-association names it, or an
// activity of a type the app continues.
- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)activity {
    continueActivity((__bridge void *)activity);
}

// iOS lets go of a scene its user swiped away, or one in the background, and may connect it again later.
- (void)sceneDidDisconnect:(UIScene *)scene {
    app::windowClosed(windowId);
    sceneClosed(windowId);
}

// The window its user uses last is the one in front.
- (void)sceneDidBecomeActive:(UIScene *)scene {
    app::windowFocused(windowId);
    sceneActivated(windowId);
}

// A tap of one of the quick actions of the app's icon while the app runs.
- (void)windowScene:(UIWindowScene *)scene performActionForShortcutItem:(UIApplicationShortcutItem *)item completionHandler:(void (^)(BOOL))done {
    done(app::shortcutItemTapped(item.type.UTF8String ?: ""));
}

@end

@interface CBAppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation CBAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    devUrl = app::devUrl();
    core = &app::start(devUrl);
    // The extensions have started, so the notification that launched the app, which comes next, reaches them.
    ownNotificationCenter();
    onQuit([] { app::quit(*core, 0); });
    return YES;
}

// The app's push token, which an extension asked for with registerForPush(), or why iOS gave none, reach every
// extension.
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)token {
    app::pushTokenArrived(hexOf(token));
}

- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error {
    app::pushTokenFailed(textOf(error.localizedDescription));
}

// A silent push, which iOS gives the app 30 s for, reaches every extension, whose answers it hears as one.
- (void)application:(UIApplication *)application
    didReceiveRemoteNotification:(NSDictionary *)payload
          fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))done {
    app::pushArrived(valueOfPlist(payload), [done](app::PushResult result) {
        const UIBackgroundFetchResult fetched = result == app::PushResult::newData  ? UIBackgroundFetchResultNewData
                                                : result == app::PushResult::failed ? UIBackgroundFetchResultFailed
                                                                                    : UIBackgroundFetchResultNoData;
        dispatch_async(dispatch_get_main_queue(), ^{
          done(fetched);
        });
    });
}

- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)session
                                   options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *configuration = [[UISceneConfiguration alloc] initWithName:@"Default" sessionRole:session.role];
    configuration.delegateClass = CBSceneDelegate.class;
    return configuration;
}

@end

// The app's Xcode project only calls this from its main(): the whole app comes prebuilt.
extern "C" int crossbind_app_main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass(CBAppDelegate.class));
    }
}

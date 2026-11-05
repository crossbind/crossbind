// An iOS app: one scene whose WKWebView page reaches a crossbind module running in Hermes, as on macOS. The page comes
// from crossbind://app/, or in a debug app the dev server opens, from the URL CROSSBIND_APP_URL names.
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#include "app.h"
#include "crossbind_app.h"

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
#endif

}  // namespace

// The status bar lies over the page: on app.window.backgroundColor, light on a dark color and dark on a light one.
@interface CBPageController : UIViewController
@end

@implementation CBPageController

#ifdef CROSSBIND_APP_BACKGROUND_COLOR
- (UIStatusBarStyle)preferredStatusBarStyle {
    return isDark(CROSSBIND_APP_BACKGROUND_COLOR) ? UIStatusBarStyleLightContent : UIStatusBarStyleDarkContent;
}
#endif

@end

@interface CBSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation CBSceneDelegate

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    // A scene that connects again, in a process that outlived the last one, gets a page of its own: what the module
    // pushed for the last page goes to none, and a link that launched the scene waits for the new one to ask.
    core->reset();
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    registerSchemeHandler((__bridge void *)configuration, "crossbind", [](SchemeRequest request, SchemeRespond respond) {
        core->serve(std::move(request), std::move(respond));
    });
    WKWebView *webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration];
#ifdef CROSSBIND_APP_BACKGROUND_COLOR
    // app.window.backgroundColor, which the launch screen shows as well, until the page paints and behind it.
    webView.opaque = NO;
    webView.backgroundColor = colorOf(CROSSBIND_APP_BACKGROUND_COLOR);
    webView.scrollView.backgroundColor = webView.backgroundColor;
#endif
#ifdef CROSSBIND_APP_DEV
    if (@available(iOS 16.4, *)) webView.inspectable = YES;
#endif
    const std::string url = app::attach(*core, (__bridge void *)webView, devUrl);

    UIViewController *controller = [CBPageController new];
    controller.view = webView;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController = controller;
    setMainWindow((__bridge void *)self.window, (__bridge void *)webView);
    [self.window makeKeyAndVisible];
    app::windowOpened();
    [webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@(url.c_str())]]];
    // A link or a document that launched the app reaches the owner of its scheme or type: the page once it asks for it,
    // or an extension; so does a site's link.
    [self scene:scene openURLContexts:options.URLContexts];
    for (NSUserActivity *activity in options.userActivities) [self scene:scene continueUserActivity:activity];
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

// A link of app.links' sites, which iOS hands the app once the site's apple-app-site-association names it.
- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)activity {
    if ([activity.activityType isEqualToString:NSUserActivityTypeBrowsingWeb] && activity.webpageURL) app::openedUrl(activity.webpageURL.absoluteString.UTF8String);
}

@end

@interface CBAppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation CBAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    devUrl = app::devUrl();
    core = &app::start(devUrl);
    onQuit([] { app::quit(*core, 0); });
    return YES;
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

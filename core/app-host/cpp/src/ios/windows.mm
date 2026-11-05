// An iOS app's windows: one for each scene that connects. An iPad app with app.ios.multipleWindows opens another for
// windows.open(), as a scene it asks iOS for, which carries the page's path in a user activity of its own and keeps it
// for iOS to restore; iOS sizes, places and closes them, and shows an iPhone's one alone.
#import <UIKit/UIKit.h>

#include "app.h"
#include "crossbind_app.h"
#include "ios/scenes.h"

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>

namespace app = crossbind::app;

namespace {

NSString *const WINDOW_ACTIVITY = @"dev.crossbind.window";
NSString *const PATH = @"crossbind.path";
NSString *const NAME = @"crossbind.name";
NSString *const TITLE = @"crossbind.title";
NSString *const REQUEST = @"crossbind.request";

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

std::string text(id value) { return [value isKindOfClass:NSString.class] ? std::string(((NSString *)value).UTF8String ?: "") : std::string(); }

// The scenes of the app's windows, by their ids; those asked to go, which iOS lets go of later; those that go once they
// have come to the front, and the windows that take the front from those that go, by the ids of those; and the
// windows.open() calls that wait for their scenes, by their requests, with the name each asked for and the options its
// scene goes without. A call of a name another waits for already joins it.
NSMapTable<NSNumber *, UIWindowScene *> *scenes;
NSHashTable<UISceneSession *> *closing;
std::set<uint64_t> closingInFront;
std::map<uint64_t, uint64_t> handovers;
struct Waiting {
    std::string name;
    std::vector<app::WindowOpened> done;
    std::vector<std::string> ignored;
};
std::map<std::string, Waiting> waiting;

UIWindowScene *sceneOf(uint64_t id) {
    UIWindowScene *scene = [scenes objectForKey:@(id)];
    if (!scene) throw std::invalid_argument("crossbind: no window " + std::to_string(id) + " of the app's is open");
    return scene;
}

// iOS sizes and places a scene's window, which has no frame of its own: what open() asked of it beside its page.
std::vector<std::string> ignoredOf(const app::WindowOptions &options) {
    const app::WindowOptions defaults;
    std::vector<std::string> ignored;
    const auto unless = [&ignored](bool isDefault, const char *key) {
        if (!isDefault) ignored.emplace_back(key);
    };
    unless(options.width == defaults.width, "width");
    unless(options.height == defaults.height, "height");
    unless(options.minWidth == 0, "minWidth");
    unless(options.minHeight == 0, "minHeight");
    unless(options.maxWidth == 0, "maxWidth");
    unless(options.maxHeight == 0, "maxHeight");
    unless(options.resizable, "resizable");
    unless(!options.fullscreen, "fullscreen");
    unless(!options.backgroundColor, "backgroundColor");
    unless(!options.x, "x");
    unless(!options.x, "y");
    unless(!options.alwaysOnTop, "alwaysOnTop");
    unless(options.frame, "frame");
    unless(options.parent == 0, "parent");
    unless(!options.modal, "modal");
    return ignored;
}

// Brings a scene to the front, or asks iOS for a new one with this activity.
void activate(UISceneSession *session, NSUserActivity *activity, void (^failed)(NSError *)) {
    UIApplication *application = UIApplication.sharedApplication;
    if (@available(iOS 17.0, *)) {
        UISceneSessionActivationRequest *request = session ? [UISceneSessionActivationRequest requestWithSession:session]
                                                           : [UISceneSessionActivationRequest requestWithRole:UIWindowSceneSessionRoleApplication];
        request.userActivity = activity;
        [application activateSceneSessionForRequest:request errorHandler:failed];
    } else {
        [application requestSceneSessionActivation:session userActivity:activity options:nil errorHandler:failed];
    }
}

}  // namespace

bool isWindowActivity(NSUserActivity *activity) { return [activity.activityType isEqualToString:WINDOW_ACTIVITY]; }

void sceneActivated(uint64_t id) {
    UIWindowScene *scene = [scenes objectForKey:@(id)];
    if (closingInFront.erase(id) > 0 && scene) {
        [UIApplication.sharedApplication requestSceneSessionDestruction:scene.session options:nil errorHandler:nil];
    }
}

void sceneClosed(uint64_t id) {
    closingInFront.erase(id);
    const auto handed = handovers.find(id);
    if (handed == handovers.end()) return;
    UIWindowScene *next = [scenes objectForKey:@(handed->second)];
    handovers.erase(handed);
    if (next && next.activationState != UISceneActivationStateForegroundActive) activate(next.session, nil, nil);
}

SceneWindow sceneWindowOf(UISceneSession *session, UISceneConnectionOptions *options) {
    SceneWindow window;
    NSDictionary *kept = session.userInfo;
    if (kept[PATH]) {
        window.path = text(kept[PATH]);
        window.name = text(kept[NAME]);
        window.title = text(kept[TITLE]);
        return window;
    }
    for (NSUserActivity *activity in options.userActivities) {
        if (!isWindowActivity(activity)) continue;
        NSDictionary *asked = activity.userInfo;
        window.path = text(asked[PATH]).empty() ? "/" : text(asked[PATH]);
        window.name = text(asked[NAME]);
        window.title = text(asked[TITLE]);
        window.request = text(asked[REQUEST]);
    }
    session.userInfo = @{PATH : ns(window.path), NAME : ns(window.name), TITLE : ns(window.title)};
    return window;
}

void sceneOpened(UIWindowScene *scene, uint64_t id, const SceneWindow &window) {
    if (!scenes) scenes = [NSMapTable strongToWeakObjectsMapTable];
    [scenes setObject:scene forKey:@(id)];
    scene.title = ns(window.title.empty() ? CROSSBIND_APP_NAME : window.title);
    const auto asked = waiting.find(window.request);
    if (asked == waiting.end()) return;
    const Waiting opened = std::move(asked->second);
    waiting.erase(asked);
    for (const auto &done : opened.done) done(std::nullopt, id, opened.ignored);
}

namespace crossbind::app {

void openAppWindow(const WindowOptions &options, WindowOpened done) {
    if (UIDevice.currentDevice.userInterfaceIdiom != UIUserInterfaceIdiomPad) throw std::runtime_error("crossbind: an iPhone shows one window of an app");
#ifndef CROSSBIND_APP_IOS_MULTIPLE_WINDOWS
    throw std::runtime_error("crossbind: an iPad app opens more windows with app.ios.multipleWindows: true in crossbind.config.js");
#else
    if (!options.name.empty()) {
        for (const Window &open : openWindows()) {
            if (nameOfWindow(open.id()) != options.name) continue;
            focusAppWindow(open.id());
            done(std::nullopt, open.id(), {});
            return;
        }
        for (auto &[request, opening] : waiting) {
            if (opening.name != options.name) continue;
            opening.done.push_back(std::move(done));
            return;
        }
    }
    NSString *request = NSUUID.UUID.UUIDString;
    NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:WINDOW_ACTIVITY];
    activity.userInfo = @{PATH : ns(options.path), NAME : ns(options.name), TITLE : ns(options.title), REQUEST : request};
    const std::string asked = request.UTF8String;
    waiting[asked] = Waiting{options.name, {std::move(done)}, ignoredOf(options)};
    activate(nil, activity, ^(NSError *error) {
      const std::string why = error.localizedDescription.UTF8String ?: "it gave no reason";
      dispatch_async(dispatch_get_main_queue(), ^{
        const auto failed = waiting.find(asked);
        if (failed == waiting.end()) return;
        const std::vector<WindowOpened> answers = std::move(failed->second.done);
        waiting.erase(failed);
        for (const auto &answer : answers) answer("crossbind: iOS opened no window: " + why, 0, {});
      });
    });
#endif
}

void changeAppWindow(uint64_t id, const WindowChanges &changes, std::vector<std::string> &ignored) {
    UIWindowScene *scene = sceneOf(id);
    if (changes.title) scene.title = ns(*changes.title);
    const std::vector<std::pair<bool, const char *>> placed{
        {changes.width.has_value(), "width"}, {changes.height.has_value(), "height"}, {changes.x.has_value(), "x"}, {changes.y.has_value(), "y"},
        {changes.center, "center"}, {changes.minWidth.has_value(), "minWidth"}, {changes.minHeight.has_value(), "minHeight"},
        {changes.maxWidth.has_value(), "maxWidth"}, {changes.maxHeight.has_value(), "maxHeight"}, {changes.resizable.has_value(), "resizable"},
        {changes.alwaysOnTop.has_value(), "alwaysOnTop"}, {changes.fullscreen.has_value(), "fullscreen"},
    };
    for (const auto &[isGiven, key] : placed) {
        if (isGiven) ignored.emplace_back(key);
    }
}

// iOS closes a scene as its user swipes it away, asking no extension; the app's last window stays as long as it runs,
// beside those already asked to go. iOS lets a window in front alone go and ignores the rest, so one that is not, as one
// still on its way to the background, comes to the front first; and as it goes, the app's window used last takes the
// front, as on the desktop, where iOS would show the Home Screen.
void closeAppWindow(uint64_t id) {
    UIWindowScene *scene = sceneOf(id);
    if (!closing) closing = [NSHashTable weakObjectsHashTable];
    std::vector<std::pair<uint64_t, UIWindowScene *>> staying;
    for (const uint64_t open : frontWindows()) {
        UIWindowScene *other = [scenes objectForKey:@(open)];
        if (other && ![closing containsObject:other.session]) staying.emplace_back(open, other);
    }
    if ([closing containsObject:scene.session]) return;
    if (staying.size() < 2) throw std::runtime_error("crossbind: iOS shows an app's last window as long as the app runs");
    [closing addObject:scene.session];
    handovers[id] = std::find_if(staying.begin(), staying.end(), [scene](const auto &other) { return other.second != scene; })->first;
    if (scene.activationState != UISceneActivationStateForegroundActive) {
        closingInFront.insert(id);
        activate(scene.session, nil, nil);
        return;
    }
    [UIApplication.sharedApplication requestSceneSessionDestruction:scene.session options:nil errorHandler:nil];
}

void focusAppWindow(uint64_t id) { activate(sceneOf(id).session, nil, nil); }

void minimizeAppWindow(uint64_t id) {
    sceneOf(id);
    throw std::runtime_error("crossbind: iOS sizes and places an app's windows itself");
}

void toggleMaximizeAppWindow(uint64_t id) { minimizeAppWindow(id); }

void dragAppWindow(uint64_t id) { minimizeAppWindow(id); }

WindowState appWindowState(uint64_t id) {
    UIWindowScene *scene = sceneOf(id);
    UIWindow *window = scene.windows.firstObject;
    const CGSize size = window.bounds.size;
    WindowState state;
    state.title = scene.title.UTF8String ?: "";
    state.width = static_cast<int>(size.width);
    state.height = static_cast<int>(size.height);
    state.isMinimized = scene.activationState == UISceneActivationStateBackground;
    state.isFullscreen = CGSizeEqualToSize(size, scene.screen.bounds.size);
    state.isFocused = scene.activationState == UISceneActivationStateForegroundActive && window.isKeyWindow;
    return state;
}

}  // namespace crossbind::app

// A macOS app's windows: NSWindows the host makes, each with the WKWebView the webview library makes in it and a
// delegate that tells the host of its close, its front and its full screen; and the app's delegate, which AppKit asks
// of the app.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

#include "desktop.h"

#include <cfloat>

namespace app = crossbind::app;

namespace {

// The windows the host made, which nothing else holds: the webview library holds none it did not make.
NSMutableArray<NSWindow *> *made;
const char DELEGATE_KEY = 0;

bool isBundled() { return [NSBundle.mainBundle.bundlePath hasSuffix:@".app"]; }

// The main screen, of the menu bar, which places windows from its top left.
CGFloat mainScreenTop() { return NSScreen.screens.firstObject.frame.size.height; }

void placeTopLeft(NSWindow *window, int x, int y) { [window setFrameTopLeftPoint:NSMakePoint(x, mainScreenTop() - y)]; }

NSSize mostOf(CGFloat width, CGFloat height) { return NSMakeSize(width > 0 ? width : CGFLOAT_MAX, height > 0 ? height : CGFLOAT_MAX); }

}  // namespace

// The app's delegate, whose class the host's answers of AppKit's questions join (answerApp).
@interface CBAppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation CBAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    // An executable outside a bundle is no regular app, and stays behind the others, until it says so.
    if (!isBundled()) {
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        [NSApp activateIgnoringOtherApps:YES];
    }
}

// The host quits the app as its last window closes.
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return NO;
}

@end

// What a window tells the host: its user's close, which the host decides; its coming to the front; and its full screen,
// which it fills whatever its limits, and holds to them again after, as AppKit keeps a window that does not resize, or
// one with a maximum, to its size there.
@interface CBWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic) uint64_t windowId;
@property(nonatomic) NSWindowStyleMask windowedStyle;
@property(nonatomic) NSSize windowedMost;
@end

@implementation CBWindowDelegate

- (BOOL)windowShouldClose:(NSWindow *)window {
    app::closeAsked(self.windowId);
    return NO;
}

- (void)windowDidBecomeKey:(NSNotification *)note {
    app::windowFocused(self.windowId);
}

- (void)windowWillEnterFullScreen:(NSNotification *)note {
    NSWindow *window = note.object;
    self.windowedStyle = window.styleMask;
    self.windowedMost = window.contentMaxSize;
    window.styleMask |= NSWindowStyleMaskResizable;
    window.contentMaxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
}

- (void)windowDidExitFullScreen:(NSNotification *)note {
    NSWindow *window = note.object;
    window.styleMask = self.windowedStyle;
    window.contentMaxSize = self.windowedMost;
}

@end

void startWindows() {
    [NSApplication sharedApplication];
    static CBAppDelegate *delegate = [CBAppDelegate new];
    NSApp.delegate = delegate;
    made = [NSMutableArray new];
    installAppMenu();
    watchApp();
}

void *makeWindow(const app::WindowOptions &options, void *, std::vector<std::string> &ignored) {
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable;
    if (options.resizable) style |= NSWindowStyleMaskResizable;
    // A window without a frame keeps its shadow, its corners and its keys, its title bar under the page; a hidden title
    // bar keeps its buttons over the page as well.
    const bool isUnderTitleBar = !options.frame || options.titleBarHidden;
    if (isUnderTitleBar) style |= NSWindowStyleMaskFullSizeContentView;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, options.width, options.height)
                                                   styleMask:style
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    window.title = @(options.title.c_str());
    if (isUnderTitleBar) {
        window.titlebarAppearsTransparent = YES;
        window.titleVisibility = NSWindowTitleHidden;
    }
    if (!options.frame) {
        for (const NSWindowButton button : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
            [window standardWindowButton:button].hidden = YES;
        }
    }
    if (options.minWidth > 0 || options.minHeight > 0) window.contentMinSize = NSMakeSize(options.minWidth, options.minHeight);
    if (options.maxWidth > 0 || options.maxHeight > 0) window.contentMaxSize = mostOf(options.maxWidth, options.maxHeight);
    if (options.alwaysOnTop) window.level = NSFloatingWindowLevel;
    // A sheet comes from its parent's title bar, wherever it was asked to be.
    if (options.modal && options.x) {
        ignored.insert(ignored.end(), {"x", "y"});
    } else if (options.x) {
        placeTopLeft(window, *options.x, *options.y);
    } else {
        [window center];
    }
    CBWindowDelegate *delegate = [CBWindowDelegate new];
    objc_setAssociatedObject(window, &DELEGATE_KEY, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    window.delegate = delegate;
    [made addObject:window];
    return (__bridge void *)window;
}

void readyWindow(void *window, void *, uint64_t id, const app::WindowOptions &, void *, std::vector<std::string> &) {
    static_cast<CBWindowDelegate *>(((__bridge NSWindow *)window).delegate).windowId = id;
}

void presentWindow(void *native, void *, const app::WindowOptions &options, void *parent) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSWindow *above = (__bridge NSWindow *)parent;
    if (above && options.modal) {
        [above beginSheet:window completionHandler:nil];
        return;
    }
    if (above) [above addChildWindow:window ordered:NSWindowAbove];
    [window makeKeyAndOrderFront:nil];
    if (options.fullscreen) {
        // A window that does not resize goes full screen only when it says it can; macOS takes it into a Space of its
        // own once the loop runs.
        window.collectionBehavior |= NSWindowCollectionBehaviorFullScreenPrimary;
        dispatch_async(dispatch_get_main_queue(), ^{
          [window toggleFullScreen:nil];
        });
    }
}

void changeWindow(void *native, void *, const app::WindowChanges &changes, std::vector<std::string> &ignored) {
    NSWindow *window = (__bridge NSWindow *)native;
    if (changes.title) window.title = @(changes.title->c_str());
    if (changes.minWidth || changes.minHeight) {
        const NSSize least = window.contentMinSize;
        window.contentMinSize = NSMakeSize(changes.minWidth.value_or(least.width), changes.minHeight.value_or(least.height));
    }
    if (changes.maxWidth || changes.maxHeight) {
        const NSSize most = window.contentMaxSize;
        window.contentMaxSize = mostOf(changes.maxWidth ? *changes.maxWidth : most.width >= CGFLOAT_MAX ? 0 : most.width,
            changes.maxHeight ? *changes.maxHeight : most.height >= CGFLOAT_MAX ? 0 : most.height);
    }
    if (changes.resizable) {
        window.styleMask = *changes.resizable ? window.styleMask | NSWindowStyleMaskResizable : window.styleMask & ~NSWindowStyleMaskResizable;
    }
    if (changes.width || changes.height) {
        const NSSize size = [window contentRectForFrameRect:window.frame].size;
        [window setContentSize:NSMakeSize(changes.width ? *changes.width : size.width, changes.height ? *changes.height : size.height)];
    }
    // A sheet stays where its parent shows it.
    if (window.sheetParent && (changes.x || changes.center)) {
        if (changes.x) ignored.insert(ignored.end(), {"x", "y"});
        if (changes.center) ignored.emplace_back("center");
    } else if (changes.x) {
        placeTopLeft(window, *changes.x, *changes.y);
    } else if (changes.center) {
        [window center];
    }
    if (changes.alwaysOnTop) window.level = *changes.alwaysOnTop ? NSFloatingWindowLevel : NSNormalWindowLevel;
    if (changes.fullscreen && *changes.fullscreen != ((window.styleMask & NSWindowStyleMaskFullScreen) != 0)) {
        window.collectionBehavior |= NSWindowCollectionBehaviorFullScreenPrimary;
        [window toggleFullScreen:nil];
    }
}

app::WindowState stateOfWindow(void *native, void *) {
    NSWindow *window = (__bridge NSWindow *)native;
    const NSRect frame = window.frame;
    const NSSize size = [window contentRectForFrameRect:frame].size;
    app::WindowState state;
    state.title = window.title.UTF8String ?: "";
    state.x = static_cast<int>(frame.origin.x);
    state.y = static_cast<int>(mainScreenTop() - frame.origin.y - frame.size.height);
    state.width = static_cast<int>(size.width);
    state.height = static_cast<int>(size.height);
    state.isMaximized = window.zoomed;
    state.isMinimized = window.miniaturized;
    state.isFullscreen = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
    state.isFocused = window.keyWindow;
    return state;
}

void focusWindow(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    if (window.miniaturized) [window deminiaturize:nil];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

void minimizeWindow(void *native) { [(__bridge NSWindow *)native miniaturize:nil]; }

void toggleMaximizeWindow(void *native) { [(__bridge NSWindow *)native zoom:nil]; }

// The press that started the page's mousedown is AppKit's current event while the page asks.
// A move starts from the press of the primary button on the page while it is down.
void dragWindow(void *native) {
    NSEvent *event = NSApp.currentEvent;
    if (event && (NSEvent.pressedMouseButtons & 1)) [(__bridge NSWindow *)native performWindowDragWithEvent:event];
}

// The library lets go of the WKWebView it made, and of the view that holds it, before the window closes.
void destroyWindow(void *native, void *parent, bool isModal, const std::function<void()> &letGo) {
    NSWindow *window = (__bridge NSWindow *)native;
    letGo();
    NSWindow *above = (__bridge NSWindow *)parent;
    if (above && isModal) [above endSheet:window];
    else if (above) [above removeChildWindow:window];
    window.delegate = nil;
    [window close];
    [made removeObject:window];
}

void runLoop() { [NSApp run]; }

void endLoop() {
    [NSApp stop:nil];
    // The loop stops after the event it handles.
    [NSApp postEvent:[NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                        location:NSZeroPoint
                                   modifierFlags:0
                                       timestamp:0
                                    windowNumber:0
                                         context:nil
                                         subtype:0
                                           data1:0
                                           data2:0]
             atStart:YES];
}

void showHiddenWindows() {
    for (NSWindow *window in made) {
        if (window.miniaturized) [window deminiaturize:nil];
        else if (!window.visible && !window.sheetParent) [window orderFront:nil];
    }
}

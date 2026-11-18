#import <TargetConditionals.h>
#if !TARGET_OS_IPHONE
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#endif

#include "page_requests.h"
#include "platform.h"

#if TARGET_OS_IPHONE
// An iOS app takes no drops of files.
void takeDrops(void *) {}
#else
namespace {

// The app's windows' webviews, which take drops for their pages.
NSHashTable<WKWebView *> *dropTargets;
// WebKit's own drop, which page-drops goes before.
IMP webKitDrop;

std::string originOf(NSURL *url) {
    std::string origin = std::string(url.scheme.lowercaseString.UTF8String ?: "") + "://" + (url.host.UTF8String ?: "");
    if (url.port) origin += ":" + std::to_string(url.port.intValue);
    return origin;
}

// WebKit takes a drop of files only where the page cancels the drag's dragover, as a browser does: the host cancels it
// on the app's own pages and those of the origins served, which the host's token marks, as Windows' does, so
// page-drops hears of every drop of files on them.
constexpr const char *ACCEPT_SCRIPT = "(() => {"
    " const isFiles = (event) => !!event.dataTransfer && event.dataTransfer.types.includes('Files');"
    " for (const name of ['dragenter', 'dragover']) addEventListener(name, (event) => { if (globalThis.__crossbind_token && isFiles(event)) event.preventDefault(); }, true);"
    "})();";

BOOL performDrop(id self, SEL command, id<NSDraggingInfo> sender) {
    WKWebView *view = self;
    if ([dropTargets containsObject:view] && view.URL && crossbind::app::isOwnOrigin(originOf(view.URL))) {
        NSArray<NSURL *> *files = [sender.draggingPasteboard readObjectsForClasses:@[ NSURL.class ]
                                                                           options:@{NSPasteboardURLReadingFileURLsOnlyKey : @YES}];
        std::vector<std::string> paths;
        for (NSURL *file in files) {
            if (file.path) paths.emplace_back(file.path.UTF8String);
        }
        if (!paths.empty()) {
            NSPoint at = [view convertPoint:sender.draggingLocation fromView:nil];
            if (!view.isFlipped) at.y = NSHeight(view.bounds) - at.y;
            crossbind::app::droppedFiles((__bridge const void *)view, paths, at.x / view.pageZoom, at.y / view.pageZoom);
        }
    }
    return reinterpret_cast<BOOL (*)(id, SEL, id<NSDraggingInfo>)>(webKitDrop)(self, command, sender);
}

}  // namespace

// webview makes a WKWebView of WebKit's class, whose performDragOperation: the host's goes before, for every WKWebView
// of the app's: one an extension makes drops as WebKit's do.
void takeDrops(void *webView) {
    addTopFrameScript(webView, ACCEPT_SCRIPT);
    if (!dropTargets) dropTargets = [NSHashTable weakObjectsHashTable];
    [dropTargets addObject:(__bridge WKWebView *)webView];
    Method method = class_getInstanceMethod(WKWebView.class, @selector(performDragOperation:));
    if (webKitDrop || !method) return;
    webKitDrop = method_getImplementation(method);
    if (!class_addMethod(WKWebView.class, @selector(performDragOperation:), reinterpret_cast<IMP>(performDrop), method_getTypeEncoding(method))) {
        method_setImplementation(method, reinterpret_cast<IMP>(performDrop));
    }
}
#endif

#import <TargetConditionals.h>
#if !TARGET_OS_IPHONE
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#endif

#include "page_requests.h"
#include "platform.h"

#include <algorithm>

#if TARGET_OS_IPHONE
// An iOS app takes no drops of files.
void takeDrops(void *, std::vector<std::string>) {}
#else
namespace {

__weak WKWebView *dropTarget;
std::vector<std::string> dropOrigins;
// WebKit's own drop, which page-drops goes before.
IMP webKitDrop;

std::string originOf(NSURL *url) {
    std::string origin = std::string(url.scheme.lowercaseString.UTF8String ?: "") + "://" + (url.host.UTF8String ?: "");
    if (url.port) origin += ":" + std::to_string(url.port.intValue);
    return origin;
}

BOOL performDrop(id self, SEL command, id<NSDraggingInfo> sender) {
    WKWebView *view = self;
    if (view == dropTarget && view.URL && std::find(dropOrigins.begin(), dropOrigins.end(), originOf(view.URL)) != dropOrigins.end()) {
        NSArray<NSURL *> *files = [sender.draggingPasteboard readObjectsForClasses:@[ NSURL.class ]
                                                                           options:@{NSPasteboardURLReadingFileURLsOnlyKey : @YES}];
        std::vector<std::string> paths;
        for (NSURL *file in files) {
            if (file.path) paths.emplace_back(file.path.UTF8String);
        }
        if (!paths.empty()) {
            NSPoint at = [view convertPoint:sender.draggingLocation fromView:nil];
            if (!view.isFlipped) at.y = NSHeight(view.bounds) - at.y;
            crossbind::app::droppedFiles(paths, at.x / view.pageZoom, at.y / view.pageZoom);
        }
    }
    return reinterpret_cast<BOOL (*)(id, SEL, id<NSDraggingInfo>)>(webKitDrop)(self, command, sender);
}

}  // namespace

// webview makes a WKWebView of WebKit's class, whose performDragOperation: the host's goes before, for every WKWebView
// of the app's: one an extension makes drops as WebKit's do.
void takeDrops(void *webView, std::vector<std::string> origins) {
    dropTarget = (__bridge WKWebView *)webView;
    dropOrigins = std::move(origins);
    Method method = class_getInstanceMethod(WKWebView.class, @selector(performDragOperation:));
    if (webKitDrop || !method) return;
    webKitDrop = method_getImplementation(method);
    if (!class_addMethod(WKWebView.class, @selector(performDragOperation:), reinterpret_cast<IMP>(performDrop), method_getTypeEncoding(method))) {
        method_setImplementation(method, reinterpret_cast<IMP>(performDrop));
    }
}
#endif

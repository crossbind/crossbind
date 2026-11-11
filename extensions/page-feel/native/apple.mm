#import <TargetConditionals.h>
#import <WebKit/WebKit.h>

#include "feel.h"

namespace crossbind::pagefeel {

void configure(void *webView) {
    WKWebView *view = (__bridge WKWebView *)webView;
    view.allowsLinkPreview = NO;
#if TARGET_OS_IPHONE
    // A page that fits its window stays put, and one that scrolls bounces as any of the system's scroll views.
    view.scrollView.alwaysBounceVertical = NO;
    view.scrollView.alwaysBounceHorizontal = NO;
#endif
    [view.configuration.userContentController addUserScript:[[WKUserScript alloc] initWithSource:@(PAGE_SCRIPT)
                                                                                   injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                                                forMainFrameOnly:YES]];
}

}  // namespace crossbind::pagefeel

#include "feel.h"

#include "crossbind/extension.h"

#ifdef __ANDROID__
#include <jni.h>
#endif

namespace crossbind::pagefeel {

const char *const PAGE_SCRIPT = R"JS(
if (window === window.top) {
    // Of no specificity and before the app's own styles, so that any of the app's rules wins.
    const style = document.createElement('style');
    style.textContent = `
        :where(html) {
            -webkit-text-size-adjust: 100%;
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
            cursor: default;
        }
        :where(input, textarea, [contenteditable]:not([contenteditable='false'])) {
            -webkit-user-select: text;
            user-select: text;
        }
        :where([contenteditable]:not([contenteditable='false'])) {
            cursor: text;
        }
        :where(a:not([draggable='true']), img:not([draggable='true'])) {
            -webkit-user-drag: none;
        }
        @media (pointer: fine) {
            :where(html) {
                overscroll-behavior: none;
            }
        }
    `;
    // WebView2 runs this before the document has its root.
    if (document.documentElement) {
        document.documentElement.prepend(style);
    } else {
        new MutationObserver((_, observer) => {
            if (!document.documentElement) return;
            document.documentElement.prepend(style);
            observer.disconnect();
        }).observe(document, { childList: true });
    }

    // An app that names either limit in its own viewport keeps it.
    addEventListener('DOMContentLoaded', () => {
        const viewport = document.querySelector('meta[name="viewport"]')
            ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport', content: 'width=device-width, initial-scale=1' }));
        if (!/maximum-scale|user-scalable/i.test(viewport.content)) viewport.content += ', maximum-scale=1, user-scalable=no';
    }, { once: true });

    // The dev server's page keeps the menu, for its Inspect Element.
    if (location.protocol === 'crossbind:') {
        addEventListener('contextmenu', (event) => {
            if (getComputedStyle(event.target).webkitUserSelect === 'none') event.preventDefault();
        });
    }

    // A tap leaves an element :hover until the next tap, where nothing can hover: it shows as pressed instead, while the
    // finger is down.
    if (matchMedia('(hover: none)').matches) {
        // WebKit gives an element :active only in a page that listens for touches.
        document.addEventListener('touchstart', () => {}, { passive: true });
        const pressedForHover = (rules) => {
            for (const rule of rules) {
                if (rule.selectorText?.includes(':hover')) rule.selectorText = rule.selectorText.replaceAll(':hover', ':active');
                if (rule.cssRules) pressedForHover(rule.cssRules);
            }
        };
        document.addEventListener('load', ({ target }) => {
            try {
                if (target.sheet) pressedForHover(target.sheet.cssRules);
            } catch {
                // Another origin's style sheet, which a page cannot read.
            }
        }, true);
    }
}
)JS";

}  // namespace crossbind::pagefeel

#ifdef __ANDROID__
extern "C" JNIEXPORT jstring JNICALL Java_dev_crossbind_extension_pagefeel_PageFeelExtension_pageScript(JNIEnv *env, jclass) {
    return env->NewStringUTF(crossbind::pagefeel::PAGE_SCRIPT);
}
#endif

void crossbind_extension_page_feel([[maybe_unused]] crossbind::Registry &registry) {
#ifndef __ANDROID__
    registry.onWindow([](const crossbind::Window &window) { crossbind::pagefeel::configure(window.webView()); });
#endif
}

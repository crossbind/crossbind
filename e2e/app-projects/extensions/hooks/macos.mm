// The sheet of the app's window, as its user reads it, and its buttons pressed as its user's click: the run's way to the
// preview extension's question on macOS. A sheet takes keys only while its app is in front, which a run's app standing
// behind another's is not, so the run reads the keys its buttons take and sends Escape's command itself.
#include "crossbind/extension.h"

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

namespace {

using crossbind::Call;
using crossbind::Value;

NSWindow *sheetUp() { return ((__bridge NSWindow *)crossbind::appWindow()).attachedSheet; }

std::string textOf(NSString *text) { return text.UTF8String ?: ""; }

void collect(NSView *view, Value::Array &texts, NSMutableArray<NSButton *> *buttons) {
    for (NSView *each in view.subviews) {
        if ([each isKindOfClass:NSButton.class] && ((NSButton *)each).title.length > 0) {
            [buttons addObject:(NSButton *)each];
        } else if ([each isKindOfClass:NSTextField.class] && ((NSTextField *)each).stringValue.length > 0) {
            texts.emplace_back(textOf(((NSTextField *)each).stringValue));
        }
        collect(each, texts, buttons);
    }
}

NSMutableArray<NSButton *> *buttonsOf(NSWindow *sheet, Value::Array &texts) {
    NSMutableArray<NSButton *> *buttons = [NSMutableArray array];
    collect(sheet.contentView, texts, buttons);
    return buttons;
}

}  // namespace

// What the sheet up shows, or null: its texts, its buttons, the one Return presses, the one Escape does, and the one with
// the focus.
void questionUp(Call call) {
    crossbind::onMainThread([call] {
        NSWindow *sheet = sheetUp();
        if (!sheet) {
            call.resolve();
            return;
        }
        Value::Array texts;
        Value::Array titles;
        Value preferred;
        Value escape;
        Value focused;
        // The button Return presses: the window's default, or one whose own key is Return.
        NSButton *byWindow = [sheet.defaultButtonCell.controlView isKindOfClass:NSButton.class] ? (NSButton *)sheet.defaultButtonCell.controlView : nil;
        for (NSButton *button in buttonsOf(sheet, texts)) {
            titles.emplace_back(textOf(button.title));
            if (button == byWindow || [button.keyEquivalent isEqualToString:@"\r"]) preferred = textOf(button.title);
            if ([button.keyEquivalent isEqualToString:@"\x1b"]) escape = textOf(button.title);
            if (sheet.firstResponder == button) focused = textOf(button.title);
        }
        call.resolve(Value::Object{{"texts", texts}, {"buttons", titles}, {"preferred", preferred}, {"escape", escape}, {"focused", focused}});
    });
}

// A button of the sheet up pressed, now or once ms passed, as when the page's own dialog will hold the page.
void pressInQuestion(Call call) {
    const std::string title = call.options()["button"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    const auto press = [title]() -> bool {
        NSWindow *sheet = sheetUp();
        Value::Array texts;
        for (NSButton *button in sheet ? buttonsOf(sheet, texts) : @[]) {
            if (textOf(button.title) != title) continue;
            [button performClick:nil];
            return true;
        }
        return false;
    };
    if (ms > 0) {
        call.resolve();
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{ press(); });
        return;
    }
    crossbind::onMainThread([call, title, press] {
        if (press()) call.resolve();
        else call.reject("crossbind e2e: no sheet up has a button " + title);
    });
}

// The sheet up ended by neither of its buttons, as another's code may end it.
void endSheet(Call call) {
    crossbind::onMainThread([call] {
        NSWindow *sheet = sheetUp();
        if (!sheet) {
            call.reject("crossbind e2e: no sheet is up to end");
            return;
        }
        [(__bridge NSWindow *)crossbind::appWindow() endSheet:sheet returnCode:NSModalResponseCancel];
        call.resolve();
    });
}

// Escape's command, which AppKit sends along the responders of the sheet when none of its buttons takes Escape.
void cancelInQuestion(Call call) {
    crossbind::onMainThread([call] {
        NSWindow *sheet = sheetUp();
        if (!sheet) {
            call.reject("crossbind e2e: no sheet is up for Escape's command");
            return;
        }
        [(sheet.firstResponder ?: sheet) tryToPerform:@selector(cancelOperation:) with:nil];
        call.resolve();
    });
}

// The preview's indicator as its user sees it on macOS: the app window's title and the Preview menu of the menu bar,
// its items with their words, and whether the window and its web view may fill the screen; an item of the menu pressed
// as AppKit performs a click on it; a script run in the page as its user's click would run it, which WebKit takes as
// its user's gesture; and the window's own full screen, as its green button asks it.
namespace {

NSMenuItem *previewMenu() {
    for (NSMenuItem *top in NSApp.mainMenu.itemArray) {
        if ([top.title isEqualToString:@"Preview"] && top.submenu) return top;
    }
    return nil;
}

bool webFullScreenOf(WKWebView *web) {
    if (@available(macOS 12.3, *)) return web.configuration.preferences.elementFullscreenEnabled;
    return [[web.configuration.preferences valueForKey:@"fullScreenEnabled"] boolValue];
}

}  // namespace

// A menu's items with their words, whether each takes a click and bears a check mark, and a submenu's own items.
Value::Array itemsOf(NSMenu *menu) {
    Value::Array items;
    for (NSMenuItem *item in menu.itemArray) {
        NSString *words = item.attributedTitle.length > 0 ? item.attributedTitle.string : item.title;
        Value::Object each{{"words", textOf(words)}, {"enabled", static_cast<bool>(item.enabled)}, {"checked", item.state == NSControlStateValueOn}};
        if (item.submenu) each.emplace_back("items", itemsOf(item.submenu));
        items.emplace_back(std::move(each));
    }
    return items;
}

// The enabled item of these words in the Preview menu or in a submenu of it.
NSMenuItem *itemOf(NSMenu *menu, const std::string &words) {
    for (NSMenuItem *item in menu.itemArray) {
        if (textOf(item.title) == words && item.enabled && !item.submenu) return item;
        if (NSMenuItem *inner = item.submenu ? itemOf(item.submenu, words) : nil) return inner;
    }
    return nil;
}

Value indicatorState() {
    NSWindow *window = (__bridge NSWindow *)crossbind::appWindow();
    WKWebView *web = (__bridge WKWebView *)crossbind::appWebView();
    NSMenuItem *menu = previewMenu();
    return Value::Object{{"up", menu != nil}, {"title", textOf(window.title)}, {"items", menu ? Value(itemsOf(menu.submenu)) : Value()},
        {"fullScreen", (window.styleMask & NSWindowStyleMaskFullScreen) != 0},
        {"windowTakesFullScreen", (window.collectionBehavior & NSWindowCollectionBehaviorFullScreenNone) == 0}, {"webTakesFullScreen", webFullScreenOf(web)}};
}

void indicatorUp(Call call) {
    crossbind::onMainThread([call] { call.resolve(indicatorState()); });
}

// An item of the Preview menu or of its Permissions, by its words, pressed now or once ms passed, as when the page's
// own dialog will hold it.
void pressIndicator(Call call) {
    const std::string words = call.options()["item"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    const auto press = [words]() -> std::optional<std::string> {
        NSMenuItem *item = itemOf(previewMenu().submenu, words);
        if (!item) return "crossbind e2e: the Preview menu has no item " + words + " to press";
        [item.menu performActionForItemAtIndex:[item.menu indexOfItem:item]];
        return std::nullopt;
    };
    if (ms > 0) {
        call.resolve();
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{ press(); });
        return;
    }
    crossbind::onMainThread([call, press] {
        const std::optional<std::string> failure = press();
        if (failure) call.reject(*failure);
        else call.resolve();
    });
}

// An item of the preview's Permissions, held while the preview ends by the app's own code, then pressed: a change that
// comes as its preview ends.
void pressAfterEnd(Call call) {
    const std::string words = call.options()["item"].asString();
    crossbind::onMainThread([call, words] {
        NSMenuItem *item = itemOf(previewMenu().submenu, words);
        if (!item) {
            call.reject("crossbind e2e: the Preview menu has no item " + words + " to hold");
            return;
        }
        crossbind::invoke("preview.close", Value::Object{}, [call, item](std::optional<std::string> failure, Value) {
            crossbind::onMainThread([call, item, failure] {
                [NSApp sendAction:item.action to:item.target from:item];
                if (failure) call.reject(*failure);
                else call.resolve();
            });
        });
    });
}

// The app in front first, as WebKit takes no full screen of a page whose window is hidden behind another app's.
void gesture(Call call) {
    NSString *script = @(call.options()["script"].asString().c_str());
    crossbind::onMainThread([call, script] {
        [NSApp activateIgnoringOtherApps:YES];
        [(__bridge NSWindow *)crossbind::appWindow() makeKeyAndOrderFront:nil];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 800 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            [(__bridge WKWebView *)crossbind::appWebView() evaluateJavaScript:script completionHandler:^(id, NSError *error) {
                if (error) call.reject(textOf(error.localizedDescription));
                else call.resolve();
            }];
        });
    });
}

// The app in front first, as a window behind another's takes no full screen, then the window's own toggle.
void fillScreen(Call call) {
    crossbind::onMainThread([call] {
        NSWindow *window = (__bridge NSWindow *)crossbind::appWindow();
        [NSApp activateIgnoringOtherApps:YES];
        [window makeKeyAndOrderFront:nil];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 800 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            [window toggleFullScreen:nil];
            call.resolve();
        });
    });
}

// The app hidden, as another app taking its user's front does, then in front again: its return to the front, which
// macOS gives only where no other app holds its user's front. Whether the app was active, and is.
void cycleActive(Call call) {
    crossbind::onMainThread([call] {
        const bool wasActive = NSApp.active;
        [NSApp hide:nil];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 800 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            [NSApp unhide:nil];
            [NSApp activateIgnoringOtherApps:YES];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 800 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                call.resolve(Value::Object{{"wasActive", wasActive}, {"isActive", static_cast<bool>(NSApp.active)}});
            });
        });
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
        NSWindow *sheet = sheetUp();
        const Value noted = Value::Object{{"event", "later"}, {"tag", tag}, {"indicator", indicatorState()},
            {"sheet", sheet ? Value(textOf(NSStringFromClass(sheet.class))) : Value()}};
        crossbind::fetch("POST", endpoint + "/report?role=app", {{"Content-Type", "application/json"}}, noted.json(), [](std::optional<std::string>, crossbind::FetchResponse) {});
    });
}

// Each open panel up, a sheet of any window's, one waiting behind another sheet among them, or one modal to the app.
NSArray<NSOpenPanel *> *panelsUp() {
    NSMutableArray<NSOpenPanel *> *panels = [NSMutableArray array];
    for (NSWindow *window in NSApp.windows) {
        for (NSWindow *sheet in window.sheets) {
            if ([sheet isKindOfClass:NSOpenPanel.class]) [panels addObject:(NSOpenPanel *)sheet];
        }
    }
    if ([NSApp.modalWindow isKindOfClass:NSOpenPanel.class] && ![panels containsObject:(NSOpenPanel *)NSApp.modalWindow]) [panels addObject:(NSOpenPanel *)NSApp.modalWindow];
    return panels;
}

void pickerUp(Call call) {
    crossbind::onMainThread([call] {
        NSArray<NSOpenPanel *> *panels = panelsUp();
        const bool isModal = [NSApp.modalWindow isKindOfClass:NSOpenPanel.class];
        call.resolve(panels.count == 0 ? Value() : Value(std::to_string(panels.count) + " NSOpenPanel" + (isModal ? ", modal to the app" : "")));
    });
}

void dismissPicker(Call call) {
    crossbind::onMainThread([call] {
        for (NSOpenPanel *panel in panelsUp()) [panel cancel:nil];
        call.resolve();
    });
}

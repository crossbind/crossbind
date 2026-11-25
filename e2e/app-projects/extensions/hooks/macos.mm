// The sheet of the app's window, as its user reads it, and its buttons and keys as its user presses them: the run's way
// to the preview extension's question on macOS.
#include "crossbind/extension.h"

#import <AppKit/AppKit.h>

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

// What the sheet up shows, or null: its texts, its buttons, the one Return presses and the one with the focus.
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
        Value focused;
        // The button Return presses: the window's default, or one whose own key is Return.
        NSButton *byWindow = [sheet.defaultButtonCell.controlView isKindOfClass:NSButton.class] ? (NSButton *)sheet.defaultButtonCell.controlView : nil;
        for (NSButton *button in buttonsOf(sheet, texts)) {
            titles.emplace_back(textOf(button.title));
            if (button == byWindow || [button.keyEquivalent isEqualToString:@"\r"]) preferred = textOf(button.title);
            if (sheet.firstResponder == button) focused = textOf(button.title);
        }
        call.resolve(Value::Object{{"texts", texts}, {"buttons", titles}, {"preferred", preferred}, {"focused", focused}});
    });
}

void pressInQuestion(Call call) {
    const std::string title = call.options()["button"].asString();
    crossbind::onMainThread([call, title] {
        NSWindow *sheet = sheetUp();
        Value::Array texts;
        for (NSButton *button in sheet ? buttonsOf(sheet, texts) : @[]) {
            if (textOf(button.title) != title) continue;
            [button performClick:nil];
            call.resolve();
            return;
        }
        call.reject("crossbind e2e: no sheet up has a button " + title);
    });
}

// A key's press and release, as the sheet's user's: Escape, Return or Space.
void keyInQuestion(Call call) {
    const std::string key = call.options()["key"].asString();
    crossbind::onMainThread([call, key] {
        NSWindow *sheet = sheetUp();
        if (!sheet) {
            call.reject("crossbind e2e: no sheet is up for a key");
            return;
        }
        NSString *characters = key == "Escape" ? @"\x1b" : key == "Return" ? @"\r" : @" ";
        const unsigned short code = key == "Escape" ? 53 : key == "Return" ? 36 : 49;
        for (const NSEventType type : {NSEventTypeKeyDown, NSEventTypeKeyUp}) {
            [sheet sendEvent:[NSEvent keyEventWithType:type
                                              location:NSZeroPoint
                                         modifierFlags:0
                                             timestamp:NSProcessInfo.processInfo.systemUptime
                                          windowNumber:sheet.windowNumber
                                               context:nil
                                            characters:characters
                           charactersIgnoringModifiers:characters
                                             isARepeat:NO
                                               keyCode:code]];
        }
        call.resolve();
    });
}

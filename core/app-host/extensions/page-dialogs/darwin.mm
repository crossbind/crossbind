#import <Cocoa/Cocoa.h>

#include "dialogs.h"

using crossbind::PageDialog;

namespace {

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

NSAlert *alertOf(const PageDialog &dialog, NSArray<NSString *> *buttons) {
    NSAlert *alert = [NSAlert new];
    alert.messageText = ns(crossbind::appName());
    alert.informativeText = ns(dialog.message());
    for (NSString *button in buttons) [alert addButtonWithTitle:button];
    return alert;
}

// A sheet on the app's window, as Safari shows them; before the app has one, a dialog of its own.
void show(NSAlert *alert, void (^done)(NSModalResponse)) {
    NSWindow *window = (__bridge NSWindow *)crossbind::appWindow();
    if (window) {
        [alert beginSheetModalForWindow:window completionHandler:done];
    } else {
        done([alert runModal]);
    }
}

}  // namespace

void showPageDialog(PageDialog dialog) {
    switch (dialog.kind()) {
    case PageDialog::Kind::alert: {
        show(alertOf(dialog, @[ @"OK" ]), ^(NSModalResponse) { dialog.accept(); });
        return;
    }
    case PageDialog::Kind::confirm: {
        show(alertOf(dialog, @[ @"OK", @"Cancel" ]), ^(NSModalResponse response) {
            if (response == NSAlertFirstButtonReturn) dialog.accept();
            else dialog.cancel();
        });
        return;
    }
    case PageDialog::Kind::prompt: {
        NSAlert *alert = alertOf(dialog, @[ @"OK", @"Cancel" ]);
        NSTextField *field = [NSTextField textFieldWithString:ns(dialog.defaultText())];
        field.frame = NSMakeRect(0, 0, 260, 24);
        alert.accessoryView = field;
        alert.window.initialFirstResponder = field;
        show(alert, ^(NSModalResponse response) {
            if (response == NSAlertFirstButtonReturn) dialog.accept(field.stringValue.UTF8String ?: "");
            else dialog.cancel();
        });
        return;
    }
    }
}

#import <UIKit/UIKit.h>

#include "dialogs.h"

using crossbind::PageDialog;

namespace {

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

// Over what the page's window shows on top, if it shows anything.
void presentOnTop(UIViewController *controller, const PageDialog &dialog) {
    UIViewController *top = ((__bridge UIWindow *)windowOf(dialog)).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (top && !top.isBeingDismissed) [top presentViewController:controller animated:YES completion:nil];
}

}  // namespace

// An alert that goes without an action, or that nothing shows, lets go of the dialog, which then answers as cancelled:
// WebKit wants an answer to every one.
void showPageDialog(PageDialog dialog) {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:ns(crossbind::appName()) message:ns(dialog.message())
                                                            preferredStyle:UIAlertControllerStyleAlert];
    const PageDialog::Kind kind = dialog.kind();
    if (kind == PageDialog::Kind::prompt) {
        [alert addTextFieldWithConfigurationHandler:^(UITextField *field) { field.text = ns(dialog.defaultText()); }];
    }
    if (kind != PageDialog::Kind::alert) {
        [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:^(UIAlertAction *) { dialog.cancel(); }]];
    }
    __weak UIAlertController *shown = alert;
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:^(UIAlertAction *) {
               dialog.accept(kind == PageDialog::Kind::prompt ? (shown.textFields.firstObject.text.UTF8String ?: "") : "");
           }]];
    presentOnTop(alert, dialog);
}

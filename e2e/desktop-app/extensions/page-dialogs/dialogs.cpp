// The page's dialogs, which src/main.js opens: a dialog of the message "cancel" is cancelled, a prompt() answered with
// what it was asked, and the rest accepted.
#include "crossbind/extension.h"

void crossbind_extension_e2e_page_dialogs(crossbind::Registry &registry) {
    using crossbind::PageDialog;
    using crossbind::Value;
    registry.onPageDialog([](const PageDialog &dialog) {
        if (dialog.message() == "cancel") {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog::Kind::prompt) {
            dialog.accept(Value(Value::Object{{"message", dialog.message()}, {"defaultText", dialog.defaultText()}}).json());
        } else {
            dialog.accept();
        }
    });
}

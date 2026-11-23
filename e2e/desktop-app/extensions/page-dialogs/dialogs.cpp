// The page's dialogs, which src/main.js opens: a dialog of the message "cancel" is cancelled, one of the message "wait"
// left for its page's end, a prompt() answered with what it was asked and the role and label of the page that asked,
// and the rest accepted.
#include "crossbind/extension.h"

#include <atomic>
#include <mutex>
#include <vector>

namespace {

// The dialogs of the message "wait", held, as one nobody holds answers, and how many answered as cancelled as their page
// went.
std::mutex waitingMutex;
std::vector<crossbind::PageDialog> waiting;
std::atomic<int> cancels{0};

}  // namespace

void crossbind_extension_e2e_page_dialogs(crossbind::Registry &registry) {
    using crossbind::PageDialog;
    using crossbind::Value;
    registry.function("page-dialogs.cancels", [](crossbind::Call call) { call.resolve(cancels.load()); });
    registry.onPageDialog([](const PageDialog &dialog) {
        if (dialog.message() == "wait") {
            dialog.onCancel([] { cancels += 1; });
            std::lock_guard<std::mutex> lock(waitingMutex);
            waiting.push_back(dialog);
        } else if (dialog.message() == "cancel") {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog::Kind::prompt) {
            dialog.accept(Value(Value::Object{{"message", dialog.message()}, {"defaultText", dialog.defaultText()}, {"role", dialog.page().role()},
                                              {"label", dialog.page().label()}})
                              .json());
        } else {
            dialog.accept();
        }
    });
}

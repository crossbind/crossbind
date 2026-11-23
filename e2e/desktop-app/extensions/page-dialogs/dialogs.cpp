// The page's dialogs, which src/main.js opens: a dialog of the message "cancel" is cancelled, one whose message starts
// with "wait" left for its page's going, a prompt() answered with what it was asked and the role and label of the page
// that asked, and the rest accepted.
#include "crossbind/extension.h"

#include <mutex>
#include <string>
#include <vector>

namespace {

// The dialogs whose message starts with "wait", held, as one nobody holds answers; the messages of those handed over,
// and of those answered as cancelled as their page went.
std::mutex heardMutex;
std::vector<crossbind::PageDialog> waiting;
std::vector<std::string> handed;
std::vector<std::string> cancelled;

}  // namespace

void crossbind_extension_e2e_page_dialogs(crossbind::Registry &registry) {
    using crossbind::PageDialog;
    using crossbind::Value;
    registry.function("page-dialogs.heard", [](crossbind::Call call) {
        std::lock_guard<std::mutex> lock(heardMutex);
        Value::Array was;
        for (const auto &message : handed) was.push_back(message);
        Value::Array went;
        for (const auto &message : cancelled) went.push_back(message);
        call.resolve(Value::Object{{"handed", was}, {"cancelled", went}});
    });
    registry.onPageDialog([](const PageDialog &dialog) {
        const std::string message = dialog.message();
        if (message.rfind("wait", 0) == 0) {
            {
                std::lock_guard<std::mutex> lock(heardMutex);
                handed.push_back(message);
                waiting.push_back(dialog);
            }
            dialog.onCancel([message] {
                std::lock_guard<std::mutex> lock(heardMutex);
                cancelled.push_back(message);
            });
        } else if (message == "cancel") {
            dialog.cancel();
        } else if (dialog.kind() == PageDialog::Kind::prompt) {
            dialog.accept(Value(Value::Object{{"message", message}, {"defaultText", dialog.defaultText()}, {"role", dialog.page().role()},
                                              {"label", dialog.page().label()}})
                              .json());
        } else {
            dialog.accept();
        }
    });
}

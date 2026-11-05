// The file and message dialogs the page calls through crossbind/app and the app's own code by their names, one at a time,
// which each platform shows; the page may reach what a file dialog's user picked.
#include "dialog.h"

#include <algorithm>
#include <atomic>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace crossbind::dialog {
namespace {

// One dialog at a time: another would open inside the first one's modal loop.
std::atomic<bool> dialogOpen{false};
// Android's dialogs take three buttons at most.
constexpr size_t MAX_BUTTONS = 3;

std::vector<std::string> texts(const Value &list) {
    std::vector<std::string> out;
    if (list.isNull()) return out;
    for (const Value &item : list.asArray()) out.push_back(item.asString());
    return out;
}

std::vector<FileFilter> filters(const Value &options) {
    std::vector<FileFilter> out;
    if (options["filters"].isNull()) return out;
    for (const Value &filter : options["filters"].asArray()) out.push_back({filter["name"].asString(""), texts(filter["extensions"])});
    return out;
}

MessageKind kindOf(const std::string &kind) {
    if (kind.empty() || kind == "info") return MessageKind::info;
    if (kind == "warning") return MessageKind::warning;
    if (kind == "error") return MessageKind::error;
    throw std::invalid_argument("crossbind: no message dialog has the kind " + kind);
}

// An extension goes without its dot, whoever gave it.
template <typename Options>
Options withoutDots(Options options) {
    for (auto &filter : options.filters) {
        for (auto &extension : filter.extensions) {
            if (!extension.empty() && extension[0] == '.') extension.erase(0, 1);
            if (extension.empty()) throw std::invalid_argument("crossbind: the filter " + filter.name + " has an empty extension");
        }
    }
    return options;
}

// Shows a dialog unless one is open.
template <typename Options, typename T>
void showDialog(void (*show)(uint64_t, Options, std::function<void(T)>), uint64_t window, std::type_identity_t<Options> options,
                std::type_identity_t<std::function<void(T)>> done) {
    if (dialogOpen.exchange(true)) throw std::runtime_error("crossbind: another dialog is open");
    try {
        show(window, std::move(options), [done = std::move(done)](T result) {
            dialogOpen = false;
            done(std::move(result));
        });
    } catch (...) {
        dialogOpen = false;
        throw;
    }
}

void allow(const std::string &path) { allowPath(path); }

void allow(const std::vector<std::string> &paths) {
    for (const auto &path : paths) allowPath(path);
}

// A file dialog, whose user's picks the page may reach then.
template <typename Options, typename T>
void showFileDialog(void (*show)(uint64_t, Options, std::function<void(T)>), uint64_t window, std::type_identity_t<Options> options,
                    std::type_identity_t<std::function<void(T)>> done) {
    showDialog(show, window, withoutDots(std::move(options)), [done = std::move(done)](T result) {
        if (result) allow(*result);
        done(std::move(result));
    });
}

// A message dialog, which a page that went around crossbind/app is held to as well; closing it clicks its last button.
void showMessage(uint64_t window, MessageOptions options, std::function<void(int)> done) {
    if (options.message.empty()) throw std::invalid_argument("crossbind: a message dialog takes a message");
    const bool hasEmptyLabel = std::any_of(options.buttons.begin(), options.buttons.end(), [](const std::string &label) { return label.empty(); });
    if (options.buttons.size() > MAX_BUTTONS || hasEmptyLabel) {
        throw std::invalid_argument("crossbind: a message dialog takes three buttons at most, each with a label");
    }
    const int last = std::max(static_cast<int>(options.buttons.size()) - 1, 0);
    showDialog(showMessageDialog, window, std::move(options), [last, done = std::move(done)](int button) { done(button < 0 ? last : button); });
}

}  // namespace
}  // namespace crossbind::dialog

void crossbind_extension_dialog(crossbind::Registry &registry) {
    using namespace crossbind::dialog;
    using crossbind::Call;
    using crossbind::Value;
    registry.function("dialog.open", [](Call call) {
        const Value &options = call.options();
        crossbind::dialog::OpenOptions open{options["title"].asString(""), options["defaultPath"].asString(""), filters(options),
                                         options["directory"].asBool(false), options["multiple"].asBool(false)};
        showFileDialog(showOpenDialog, call.page().windowId(), std::move(open), [call](Picked picked) { call.resolve(picked ? Value(*picked) : Value()); });
    });
    registry.function("dialog.save", [](Call call) {
        const Value &options = call.options();
        crossbind::dialog::SaveOptions save{options["title"].asString(""), options["defaultPath"].asString(""), options["defaultName"].asString(""),
                                         filters(options)};
        showFileDialog(showSaveDialog, call.page().windowId(), std::move(save), [call](std::optional<std::string> file) { call.resolve(file ? Value(*file) : Value()); });
    });
    registry.function("dialog.message", [](Call call) {
        const Value &options = call.options();
        showMessage(call.page().windowId(), {options["message"].asString(""), options["detail"].asString(""), kindOf(options["kind"].asString("")), texts(options["buttons"])},
                    [call](int button) { call.resolve(button); });
    });
}

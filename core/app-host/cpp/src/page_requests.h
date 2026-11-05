#pragma once

// The page's dialogs, what it asks to use and its file inputs, as a platform's webview hands them over: the core hands
// each to its owner, the extension named page-dialogs, page-permissions or page-files.
#include "crossbind/extension.h"

#ifdef __OBJC__
#import <WebKit/WebKit.h>
#endif

#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#if !defined(__ANDROID__)

namespace crossbind {

// The answer the webview gets once, on the main thread, where it takes it: the fallback when every copy of its request
// goes unanswered.
template <typename Answer>
class AnswerOnce {
public:
    AnswerOnce(std::function<void(Answer)> answer, Answer fallback) : answer_(std::move(answer)), fallback_(std::move(fallback)) {}
    AnswerOnce(const AnswerOnce &) = delete;
    AnswerOnce &operator=(const AnswerOnce &) = delete;
    ~AnswerOnce() { give(std::move(fallback_)); }

    void give(Answer value) {
        if (isGiven_.exchange(true)) return;
        onMainThread([answer = std::move(answer_), value = std::move(value)] { answer(value); });
    }

private:
    std::function<void(Answer)> answer_;
    Answer fallback_;
    std::atomic<bool> isGiven_{false};
};

// A dialog's answer: the text a prompt gives, or an alert's or a confirm's OK, with an empty one; none for Cancel.
struct PageDialog::State {
    State(Kind kind, std::string message, std::string defaultText, std::function<void(std::optional<std::string>)> answer)
        : kind(kind), message(std::move(message)), defaultText(std::move(defaultText)), answer(std::move(answer), std::nullopt) {}

    Kind kind;
    std::string message;
    std::string defaultText;
    AnswerOnce<std::optional<std::string>> answer;
};

struct PagePermission::State {
    State(std::vector<std::string> kinds, std::string origin, bool isListed, std::function<void(bool)> answer)
        : kinds(std::move(kinds)), origin(std::move(origin)), isListed(isListed), answer(std::move(answer), false) {}

    std::vector<std::string> kinds;
    std::string origin;
    bool isListed;
    AnswerOnce<bool> answer;
};

// A file input's answer: the paths picked; none for Cancel.
struct FileInput::State {
    State(bool allowsMultiple, bool allowsFolders, std::vector<std::string> accept,
        std::function<void(std::optional<std::vector<std::string>>)> answer)
        : allowsMultiple(allowsMultiple), allowsFolders(allowsFolders), accept(std::move(accept)), answer(std::move(answer), std::nullopt) {}

    bool allowsMultiple;
    bool allowsFolders;
    std::vector<std::string> accept;
    AnswerOnce<std::optional<std::vector<std::string>>> answer;
};

}  // namespace crossbind

namespace crossbind::app {

#ifdef __OBJC__
// An origin as the page's scripts name it, as "crossbind://app" or "http://localhost:5173".
inline std::string originOf(WKSecurityOrigin *origin) {
    std::string text = std::string(origin.protocol.UTF8String ?: "") + "://" + std::string(origin.host.UTF8String ?: "");
    if (origin.port != 0) text += ":" + std::to_string(origin.port);
    return text;
}
#endif

// A request of the page's for these kinds, which knows whether app.permissions lists each.
PagePermission pagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(bool)> decide);

// Whether an extension takes them on this platform; without one, the webview does as it would.
bool hasPageDialogs();
bool hasPagePermissions();
bool hasFileInputs();
// Hand a request to its owner, on the main thread: one the owner fails on goes unanswered, and so cancelled.
void askPageDialog(PageDialog dialog);
void askPagePermission(PagePermission request);
void askFileInput(FileInput input);

}  // namespace crossbind::app

#endif

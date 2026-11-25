// The camera, the microphone and the location a project's page asks for: the app's own question, drawn natively for the
// preview the extension serves and answered at its two buttons alone, and each answer kept in preview/consents.json in
// the app's data folder by the origin's name and the kind, as {"<name>":{"camera":true,"location":false}}. A store that
// cannot be read, is no JSON or has another shape gives no consent, and a value that is neither true nor false is no
// answer. Android's requests are its Java's (PreviewExtension.java), which keeps the same file.
#include "preview.h"

#if defined(__ANDROID__)

namespace preview {

// Its Java takes the page's requests: it holds the preview served from here on.
void serveConsents(Served served, std::function<void()> then) {
    crossbind::android::callJava("preview", "serving", {{"url", served.url}, {"name", served.name}, {"project", served.project}},
        [then](Failure, Value) { then(); });
}

void endConsents() {
    crossbind::android::callJava("preview", "ended", {}, [](Failure, Value) {});
}

}  // namespace preview

#else

#include <algorithm>
#include <cstdio>
#include <map>
#include <mutex>

namespace preview {
namespace {

using crossbind::PagePermission;

// The kinds a project is asked for; any other is denied it with no question.
const std::vector<std::string> ASKED{"camera", "microphone", "location"};
const std::string CONSENTS = "consents.json";
const std::string DETAIL = "It is a preview of your project. You can change this in the preview's menu.";
// The quotes around the project's name, in UTF-8.
const std::string OPENING = "\xE2\x80\x9C";
const std::string CLOSING = "\xE2\x80\x9D";

// What is kept of a request's kinds: each allowed, one denied, or one not answered yet.
enum class Kept { allowed, denied, open };

// A question to show: its number, the window of the request it is asked for, its words and the kinds it asks about.
struct Question {
    uint64_t number;
    uint64_t window;
    std::string message;
    std::vector<std::string> kinds;
};

// What a change of the waiting requests decided, which is given once the lock is let go of.
struct Settled {
    std::vector<PagePermission> allowed;
    std::vector<PagePermission> denied;
    std::optional<Question> question;
};

std::mutex consentsMutex;
std::optional<Served> served;
// The requests that wait for the question up, in the order they came.
std::vector<PagePermission> waiting;
// The question up, by its number, the kinds it asks about, and what closes it. A number is used once, as each is asked
// and as the preview ends, so that the answer of a question gone keeps nothing.
uint64_t asked = 0;
std::optional<std::vector<std::string>> asking;
std::function<void()> closeAsking;
// The answers the store could not keep, which hold for the app's run: by the origin's name and the kind.
std::map<std::string, std::map<std::string, bool>> held;

bool isAsked(const std::string &kind) { return std::find(ASKED.begin(), ASKED.end(), kind) != ASKED.end(); }

std::string nounOf(const std::string &kind) { return kind == "location" ? "your location" : "the " + kind; }

// As "Allow “made-up-app” to use the camera and the microphone?".
std::string messageOf(const std::string &project, const std::vector<std::string> &kinds) {
    std::string named;
    for (std::size_t i = 0; i < kinds.size(); i += 1) {
        if (i > 0) named += i + 1 == kinds.size() ? " and " : ", ";
        named += nounOf(kinds[i]);
    }
    return "Allow " + OPENING + project + CLOSING + " to use " + named + "?";
}

// The store, an object: an empty one where it cannot be read, is no JSON or has another shape.
Value store() {
    const std::optional<std::string> text = readDataFile(CONSENTS);
    try {
        Value kept = text ? parseJson(*text) : Value();
        return kept.isObject() ? kept : Value(Value::Object{});
    } catch (const std::exception &) {
        return Value::Object{};
    }
}

// The answer kept of a kind of an origin: one the store could not keep, else the store's own true or false.
std::optional<bool> keptOf(const Value &kept, const std::string &origin, const std::string &kind) {
    if (const auto run = held.find(origin); run != held.end()) {
        if (const auto answer = run->second.find(kind); answer != run->second.end()) return answer->second;
    }
    const Value &answer = kept[origin][kind];
    return answer.isBool() ? std::optional<bool>(answer.asBool()) : std::nullopt;
}

Kept keptFor(const Value &kept, const std::string &origin, const std::vector<std::string> &kinds) {
    bool isOpen = false;
    for (const auto &kind : kinds) {
        const std::optional<bool> answer = keptOf(kept, origin, kind);
        if (answer && !*answer) return Kept::denied;
        if (!answer) isOpen = true;
    }
    return isOpen ? Kept::open : Kept::allowed;
}

// Keeps an answer for these kinds of the origin, the store's other entries as they were; one the store cannot take
// holds for the app's run, and the output says so.
void keep(const std::string &origin, const std::vector<std::string> &kinds, bool isAllowed) {
    const Value kept = store();
    Value::Object entries;
    Value::Object entry;
    bool isSeen = false;
    for (const auto &[name, value] : kept.asObject()) {
        if (name != origin) {
            entries.emplace_back(name, value);
            continue;
        }
        if (isSeen || !value.isObject()) continue;
        isSeen = true;
        for (const auto &[kind, answer] : value.asObject()) {
            const bool isTaken = std::any_of(entry.begin(), entry.end(), [&kind](const auto &member) { return member.first == kind; });
            if (answer.isBool() && !isTaken && std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) entry.emplace_back(kind, answer);
        }
    }
    for (const auto &kind : kinds) entry.emplace_back(kind, isAllowed);
    entries.emplace_back(origin, Value(std::move(entry)));
    const Failure failure = writeDataFile(CONSENTS, Value(std::move(entries)).json());
    if (!failure) return;
    for (const auto &kind : kinds) held[origin][kind] = isAllowed;
    std::fprintf(stderr, "crossbind: preview could not keep an answer in its %s, which holds for this run: %s\n", CONSENTS.c_str(), failure->c_str());
}

// Decides each waiting request that what is kept decides, and asks about the first other one's kinds not answered yet,
// where no question is up. Under the lock, with a preview served.
Settled settle() {
    Settled settled;
    const Value kept = store();
    std::vector<PagePermission> still;
    for (const PagePermission &request : waiting) {
        switch (keptFor(kept, served->name, request.kinds())) {
        case Kept::allowed:
            settled.allowed.push_back(request);
            break;
        case Kept::denied:
            settled.denied.push_back(request);
            break;
        case Kept::open:
            still.push_back(request);
            break;
        }
    }
    waiting = std::move(still);
    if (asking || waiting.empty()) return settled;
    std::vector<std::string> kinds;
    for (const auto &kind : waiting.front().kinds()) {
        if (!keptOf(kept, served->name, kind) && std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) kinds.push_back(kind);
    }
    asked += 1;
    asking = kinds;
    closeAsking = nullptr;
    settled.question = Question{asked, waiting.front().page().windowId(), messageOf(served->project, kinds), kinds};
    return settled;
}

void give(Settled settled);

// Its user's answer at a button, or none where the question could not be shown, which keeps nothing and denies what
// waits; an answer of a question that went before it, as at the preview's end, keeps nothing either.
void answered(uint64_t number, const std::vector<std::string> &kinds, std::optional<bool> isAllowed) {
    Settled settled;
    {
        std::lock_guard<std::mutex> lock(consentsMutex);
        if (number != asked || !asking || !served) return;
        asking.reset();
        closeAsking = nullptr;
        if (isAllowed.has_value()) {
            keep(served->name, kinds, *isAllowed);
            settled = settle();
        } else {
            settled.denied.swap(waiting);
        }
    }
    give(std::move(settled));
}

// On the main thread, as the holder's hook and the question's answer are.
void show(const Question &question) {
    std::function<void()> close = showConsent(question.window, question.message, DETAIL,
        [number = question.number, kinds = question.kinds](std::optional<bool> isAllowed) { answered(number, kinds, isAllowed); });
    {
        std::lock_guard<std::mutex> lock(consentsMutex);
        if (asking && asked == question.number) {
            closeAsking = std::move(close);
            return;
        }
    }
    // The preview ended as it came up.
    if (close) close();
}

void give(Settled settled) {
    for (const auto &request : settled.allowed) request.allow();
    for (const auto &request : settled.denied) request.deny();
    if (settled.question) show(*settled.question);
}

}  // namespace

void serveConsents(Served preview, std::function<void()> then) {
    endConsents();
    {
        std::lock_guard<std::mutex> lock(consentsMutex);
        served = std::move(preview);
    }
    then();
}

void endConsents() {
    std::vector<PagePermission> ending;
    std::function<void()> close;
    {
        std::lock_guard<std::mutex> lock(consentsMutex);
        served.reset();
        ending.swap(waiting);
        close.swap(closeAsking);
        asking.reset();
        asked += 1;
    }
    for (const auto &request : ending) request.deny();
    if (close) close();
}

// One of the three kinds alone, each listed in app.permissions, of the preview's own origin: on Apple's platforms a
// device used without its usage text ends the app.
void askConsent(PagePermission request) {
    const std::vector<std::string> &kinds = request.kinds();
    const bool isAskable = request.isListed() && !kinds.empty() && std::all_of(kinds.begin(), kinds.end(), isAsked);
    Settled settled;
    {
        std::lock_guard<std::mutex> lock(consentsMutex);
        if (isAskable && served && request.origin() + "/" == served->url) {
            waiting.push_back(request);
            settled = settle();
        } else {
            settled.denied.push_back(request);
        }
    }
    give(std::move(settled));
}

}  // namespace preview

#endif

// What the app's extensions add as it starts (<crossbind/extension.h>), and the page's calls of the app's functions:
// what the page passed as a JSON value, the function of the name it called, and the answer. Also the JSON an Android
// extension's Java answers with.
#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "host_core.h"
#include "page_requests.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <locale>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <thread>

namespace crossbind {

struct Call::State {
    std::string name;
    Value options;
    // A call is the page's, which the scope checks hold to, unless the host's own code made it.
    bool isFromApp = false;
    // The page that made it, in its window; none for the host's own code.
    uint64_t page = 0;
    uint64_t window = 0;
    // The answer, with how many messages went before it, and the messages of a call whose page takes them.
    std::function<void(Failure, Value, double sent)> answer;
    std::function<void(Value)> message;
    // Keeps the messages, the answer and the cancel in one order.
    std::mutex mutex;
    bool isAnswered = false;
    bool isCancelled = false;
    double sent = 0;
    std::vector<std::function<void()>> cancelled;

    // Whether the caller's answer is the one; before gets how many messages it follows. What the call held for its
    // messages and its cancel goes, which may hold the call itself, as a job its onCancel stops does.
    bool answers(double &before) {
        std::vector<std::function<void()>> dropped;
        std::function<void(Value)> sending;
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (isAnswered) return false;
            isAnswered = true;
            before = sent;
            dropped = std::move(cancelled);
            sending = std::move(message);
        }
        return true;
    }
    // What an answer throws here would end the app, so it is told instead.
    ~State() {
        double before = 0;
        if (!answers(before)) return;
        try {
            answer("crossbind: " + name + " gave no answer", {}, before);
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the answer to %s failed: %s\n", name.c_str(), error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the answer to %s failed\n", name.c_str());
        }
    }
};

namespace {

namespace jsi = facebook::jsi;
using Functions = std::map<std::string, Registry::Function>;

Functions &added() {
    static Functions functions;
    return functions;
}

std::atomic<bool> isSealed{false};

const char *kindOf(const Value &value) {
    if (value.isNull()) return "null";
    if (value.isBool()) return "a boolean";
    if (value.isNumber()) return "a number";
    if (value.isString()) return "a string";
    if (value.isBytes()) return "bytes";
    return value.isArray() ? "an array" : "an object";
}

// What stands in JSON for bytes an Android extension's Java takes or gives beside the text, by their place among them.
constexpr const char *BYTES_TAG = "\x01" "t";

[[noreturn]] void wrongKind(const Value &value, const char *wanted) {
    throw std::invalid_argument(std::string("crossbind: expected ") + wanted + ", not " + kindOf(value));
}

void appendString(std::string &out, const std::string &text) {
    out += '"';
    for (const unsigned char c : app::validUtf8(text)) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            char escaped[7];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
            out += escaped;
        } else {
            out += static_cast<char>(c);
        }
    }
    out += '"';
}

// Below 2^53 a double holds every integer.
constexpr double EXACT_INTEGERS = 9007199254740992.0;

// An integer in full, another number in the fewest digits that read back as it, and one JSON has not as null, as
// JSON.stringify writes them; in the C++ locale, whatever C locale GTK set from the user's.
std::string numberJson(double number) {
    if (!std::isfinite(number)) return "null";
    if (std::trunc(number) == number && std::fabs(number) < EXACT_INTEGERS) return std::to_string(static_cast<long long>(number));
    std::string text;
    for (int precision = 15; precision <= 17; precision += 1) {
        std::ostringstream out;
        out.imbue(std::locale::classic());
        out.precision(precision);
        out << number;
        text = out.str();
        std::istringstream in(text);
        in.imbue(std::locale::classic());
        double back = 0;
        in >> back;
        if (back == number) break;
    }
    return text;
}

// Bytes go into bytes, where there are any, and their place into the text; without, they throw.
void appendJson(std::string &out, const Value &value, std::vector<Value::Bytes> *bytes) {
    if (value.isNull()) {
        out += "null";
    } else if (value.isBool()) {
        out += value.asBool() ? "true" : "false";
    } else if (value.isNumber()) {
        out += numberJson(value.asNumber());
    } else if (value.isString()) {
        appendString(out, value.asString());
    } else if (value.isBytes()) {
        if (!bytes) throw std::invalid_argument("crossbind: bytes have no JSON text");
        out += "{\"\\u0001t\":\"bytes\",\"i\":" + std::to_string(bytes->size()) + "}";
        bytes->push_back(value.asBytes());
    } else if (value.isArray()) {
        out += '[';
        for (const Value &item : value.asArray()) {
            if (&item != &value.asArray().front()) out += ',';
            appendJson(out, item, bytes);
        }
        out += ']';
    } else {
        out += '{';
        for (const auto &member : value.asObject()) {
            if (&member != &value.asObject().front()) out += ',';
            appendString(out, member.first);
            out += ':';
            appendJson(out, member.second, bytes);
        }
        out += '}';
    }
}

// The bytes of a value of JSON text, in the places their tags hold.
Value withBytes(const Value &value, const std::vector<Value::Bytes> &bytes) {
    if (value.isArray()) {
        Value::Array items;
        for (const Value &item : value.asArray()) items.push_back(withBytes(item, bytes));
        return items;
    }
    if (!value.isObject()) return value;
    const Value &tag = value[BYTES_TAG];
    if (tag.isString() && tag.asString() == "bytes" && value.asObject().size() == 2) {
        const double at = value["i"].asNumber(-1);
        if (at < 0 || at >= static_cast<double>(bytes.size()) || at != static_cast<double>(static_cast<size_t>(at))) {
            throw std::invalid_argument("crossbind: the JSON names bytes it does not carry");
        }
        return bytes[static_cast<size_t>(at)];
    }
    Value::Object members;
    for (const auto &[name, member] : value.asObject()) members.emplace_back(name, withBytes(member, bytes));
    return members;
}

// Far deeper than any options: a page that nests more gets an error, not a host that runs out of stack.
constexpr int MAX_DEPTH = 64;

Value::Bytes bytesOf(jsi::Runtime &rt, jsi::ArrayBuffer buffer, size_t offset, size_t length) {
    const uint8_t *data = buffer.data(rt) + offset;
    return Value::Bytes(data, data + length);
}

// What the page passed, which came as JSON text with its bytes beside it; undefined, which JSON.stringify drops, is null.
Value valueOf(jsi::Runtime &rt, const jsi::Value &value, int depth) {
    if (depth > MAX_DEPTH) throw std::invalid_argument("crossbind: the page passed options nested deeper than an app takes");
    if (value.isBool()) return value.getBool();
    if (value.isNumber()) return value.getNumber();
    if (value.isString()) return value.getString(rt).utf8(rt);
    if (!value.isObject()) return {};
    const jsi::Object object = value.getObject(rt);
    if (object.isArrayBuffer(rt)) {
        jsi::ArrayBuffer buffer = object.getArrayBuffer(rt);
        const size_t length = buffer.size(rt);
        return bytesOf(rt, std::move(buffer), 0, length);
    }
    if (rt.global().getPropertyAsObject(rt, "ArrayBuffer").getPropertyAsFunction(rt, "isView").call(rt, value).getBool()) {
        jsi::ArrayBuffer buffer = object.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
        const auto offset = static_cast<size_t>(object.getProperty(rt, "byteOffset").asNumber());
        const auto length = static_cast<size_t>(object.getProperty(rt, "byteLength").asNumber());
        if (offset > buffer.size(rt) || length > buffer.size(rt) - offset) throw std::invalid_argument("crossbind: a view of bytes reaches past its buffer");
        return bytesOf(rt, std::move(buffer), offset, length);
    }
    if (object.isArray(rt)) {
        const jsi::Array array = object.getArray(rt);
        Value::Array items;
        for (size_t i = 0; i < array.size(rt); i += 1) items.push_back(valueOf(rt, array.getValueAtIndex(rt, i), depth + 1));
        return items;
    }
    const jsi::Array names = object.getPropertyNames(rt);
    Value::Object members;
    for (size_t i = 0; i < names.size(rt); i += 1) {
        const jsi::String name = names.getValueAtIndex(rt, i).toString(rt);
        members.emplace_back(name.utf8(rt), valueOf(rt, object.getProperty(rt, name), depth + 1));
    }
    return members;
}

void appendUtf8(std::string &out, char32_t point) {
    if (point < 0x80) {
        out += static_cast<char>(point);
    } else if (point < 0x800) {
        out += static_cast<char>(0xC0 | point >> 6);
        out += static_cast<char>(0x80 | (point & 0x3F));
    } else if (point < 0x10000) {
        out += static_cast<char>(0xE0 | point >> 12);
        out += static_cast<char>(0x80 | (point >> 6 & 0x3F));
        out += static_cast<char>(0x80 | (point & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | point >> 18);
        out += static_cast<char>(0x80 | (point >> 12 & 0x3F));
        out += static_cast<char>(0x80 | (point >> 6 & 0x3F));
        out += static_cast<char>(0x80 | (point & 0x3F));
    }
}

// JSON text, read as strictly as RFC 8259 writes it.
class JsonReader {
public:
    explicit JsonReader(std::string_view text) : text_(text) {}

    Value document() {
        Value value = next(0);
        skipSpace();
        if (at_ != text_.size()) fail();
        return value;
    }

private:
    std::string_view text_;
    size_t at_ = 0;

    [[noreturn]] void fail() const { throw std::invalid_argument("crossbind: no JSON at byte " + std::to_string(at_)); }

    bool isAt(char c) const { return at_ < text_.size() && text_[at_] == c; }

    bool isDigit() const { return at_ < text_.size() && text_[at_] >= '0' && text_[at_] <= '9'; }

    void skipDigits() {
        if (!isDigit()) fail();
        while (isDigit()) at_ += 1;
    }

    void skipSpace() {
        while (isAt(' ') || isAt('\t') || isAt('\n') || isAt('\r')) at_ += 1;
    }

    bool take(char c) {
        skipSpace();
        if (!isAt(c)) return false;
        at_ += 1;
        return true;
    }

    void expect(char c) {
        if (!take(c)) fail();
    }

    bool takeWord(std::string_view word) {
        if (text_.substr(at_, word.size()) != word) return false;
        at_ += word.size();
        return true;
    }

    Value next(int depth) {
        if (depth > MAX_DEPTH) throw std::invalid_argument("crossbind: JSON nested deeper than an app takes");
        if (take('{')) return object(depth);
        if (take('[')) return array(depth);
        if (isAt('"')) return string();
        if (takeWord("true")) return true;
        if (takeWord("false")) return false;
        if (takeWord("null")) return nullptr;
        return number();
    }

    Value object(int depth) {
        Value::Object members;
        if (take('}')) return members;
        do {
            skipSpace();
            if (!isAt('"')) fail();
            std::string key = string();
            expect(':');
            members.emplace_back(std::move(key), next(depth + 1));
        } while (take(','));
        expect('}');
        return members;
    }

    Value array(int depth) {
        Value::Array items;
        if (take(']')) return items;
        do {
            items.push_back(next(depth + 1));
        } while (take(','));
        expect(']');
        return items;
    }

    std::string string() {
        at_ += 1;
        std::string text;
        for (;;) {
            if (at_ == text_.size() || static_cast<unsigned char>(text_[at_]) < 0x20) fail();
            const char c = text_[at_++];
            if (c == '"') return text;
            if (c != '\\') {
                text += c;
                continue;
            }
            if (at_ == text_.size()) fail();
            switch (const char escaped = text_[at_++]) {
            case '"':
            case '\\':
            case '/': text += escaped; break;
            case 'b': text += '\b'; break;
            case 'f': text += '\f'; break;
            case 'n': text += '\n'; break;
            case 'r': text += '\r'; break;
            case 't': text += '\t'; break;
            case 'u': appendUtf8(text, codePoint()); break;
            default: fail();
            }
        }
    }

    unsigned hexUnit() {
        if (text_.size() - at_ < 4) fail();
        unsigned unit = 0;
        for (const char c : text_.substr(at_, 4)) {
            const int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
            if (digit < 0) fail();
            unit = unit << 4 | static_cast<unsigned>(digit);
        }
        at_ += 4;
        return unit;
    }

    // A pair of surrogates escaped is one code point; one alone has no UTF-8 and reads as U+FFFD.
    char32_t codePoint() {
        const unsigned unit = hexUnit();
        if (unit < 0xD800 || unit > 0xDFFF) return unit;
        if (unit <= 0xDBFF && text_.substr(at_, 2) == "\\u") {
            const size_t low = at_;
            at_ += 2;
            const unsigned next = hexUnit();
            if (next >= 0xDC00 && next <= 0xDFFF) return 0x10000 + ((unit - 0xD800) << 10) + (next - 0xDC00);
            at_ = low;
        }
        return 0xFFFD;
    }

    Value number() {
        const size_t start = at_;
        if (isAt('-')) at_ += 1;
        if (isAt('0')) {
            at_ += 1;
        } else {
            skipDigits();
        }
        if (isAt('.')) {
            at_ += 1;
            skipDigits();
        }
        if (isAt('e') || isAt('E')) {
            at_ += 1;
            if (isAt('+') || isAt('-')) at_ += 1;
            skipDigits();
        }
        std::istringstream in(std::string(text_.substr(start, at_ - start)));
        in.imbue(std::locale::classic());
        double number = 0;
        in >> number;
        if (in.fail()) fail();
        return number;
    }
};

// What the app's extensions do as it is launched, starts, quits and opens their links, each with its extension's name,
// who takes the page's requests, and the holder of each of the host's roles.
struct Hooks {
    std::string launcher;
    std::function<bool(const Launch &)> launch;
    std::vector<std::pair<std::string, std::function<void()>>> starts;
    std::vector<std::pair<std::string, std::function<void(const Window &)>>> windows;
    std::vector<std::pair<std::string, std::function<void(const Window &)>>> closedWindows;
    std::vector<std::pair<std::string, std::function<void(const Page &)>>> pages;
    std::vector<std::pair<std::string, std::function<bool(const Window &)>>> closes;
    std::vector<std::pair<std::string, std::function<void(bool)>>> actives;
    std::vector<std::pair<std::string, std::function<bool()>>> quitRequests;
    std::vector<std::pair<std::string, std::function<void()>>> reopens;
    std::vector<std::pair<std::string, std::function<void()>>> quits;
    std::map<std::string, std::function<void(const OpenUrl &)>> urls;
    std::map<std::string, std::function<void(const OpenFiles &)>> openers;
    std::map<std::string, std::function<bool(const UserActivity &)>> activities;
    std::map<std::string, std::function<bool(const ShortcutItem &)>> shortcuts;
    std::vector<std::pair<std::string, std::function<void(const Notification &)>>> notifications;
    std::vector<std::pair<std::string, std::function<void(const PushToken &)>>> pushTokens;
    std::vector<std::pair<std::string, std::function<void(const PushTokenFailure &)>>> pushFailures;
    std::vector<std::pair<std::string, std::function<void(const Value &, PushDone)>>> pushMessages;
    std::map<std::string, std::function<void(Request)>> routes;
    std::function<NavigationAnswer(const Navigation &)> navigations;
    std::function<void(HttpAuthentication)> httpAuthentications;
    std::function<void(CertificateError)> certificateErrors;
    std::function<void(Download)> downloads;
    std::function<void(const Drop &)> drops;
#if !defined(__ANDROID__)
    std::function<void(PageDialog)> pageDialogs;
    std::function<void(PagePermission)> pagePermissions;
    std::function<void(FileInput)> fileInputs;
#endif
    std::map<std::string, std::string> holders;
};

Hooks &hooks() {
    static Hooks all;
    return all;
}

// The app runs on with its launch, so its extensions quit with it.
std::atomic<bool> isLaunched{false};
// Once the extensions have quit, as before a failure's message box shows, nothing asks or tells them more.
std::atomic<bool> hasQuit{false};

// An extension adds what it does as its entry runs, which is before the app's module starts.
void checkStarting(const std::string &what) {
    if (isSealed) throw std::logic_error("crossbind: " + what + " came after the app started: an extension adds what it does as its entry runs");
}

bool holds(const std::vector<std::string> &roles, const std::string &role) { return std::find(roles.begin(), roles.end(), role) != roles.end(); }

// The page's requests of a kind go to the holder of their role alone, the host's extension or an app's in its place: one
// of the host's leaves those of a role it gave an app's extension.
template <typename Hook>
void takePageRequests(Hook &owner, Hook fn, const std::string &extension, const std::vector<std::string> &roles, const std::vector<std::string> &given,
    const char *role, const char *hook) {
    checkStarting("the extension " + extension + "'s " + hook);
    if (holds(given, role)) return;
    if (!holds(roles, role)) {
        throw std::logic_error(std::string("crossbind: the extension ") + extension + " calls " + hook + ", which the holder of the host's " + role +
                               " alone does: replaces: '" + role + "' in its crossbind.extension.js takes it");
    }
    if (owner) throw std::logic_error("crossbind: the extension " + extension + " calls " + hook + " twice");
    owner = std::move(fn);
}

// The extension's event of this name, which the pages' listeners of <extension>.<name> get.
void sendEvent(const std::string &extension, const std::string &name, const Value &value, bool isHeld, app::Reach reach = app::Reach::everyPage,
    uint64_t page = 0) {
    if (name.empty()) throw std::invalid_argument("crossbind: the extension " + extension + " sends an event without a name");
    app::postEvent(extension + "." + name, value.json(), isHeld, reach, page);
}

}  // namespace

bool Value::asBool() const {
    if (!isBool()) wrongKind(*this, "a boolean");
    return std::get<bool>(data_);
}

bool Value::asBool(bool fallback) const { return isNull() ? fallback : asBool(); }

double Value::asNumber() const {
    if (!isNumber()) wrongKind(*this, "a number");
    return std::get<double>(data_);
}

double Value::asNumber(double fallback) const { return isNull() ? fallback : asNumber(); }

const std::string &Value::asString() const {
    if (!isString()) wrongKind(*this, "a string");
    return std::get<std::string>(data_);
}

std::string Value::asString(std::string fallback) const { return isNull() ? fallback : asString(); }

const Value::Array &Value::asArray() const {
    if (!isArray()) wrongKind(*this, "an array");
    return *std::get<std::shared_ptr<const Array>>(data_);
}

const Value::Object &Value::asObject() const {
    if (!isObject()) wrongKind(*this, "an object");
    return *std::get<std::shared_ptr<const Object>>(data_);
}

const Value::Bytes &Value::asBytes() const {
    if (!isBytes()) wrongKind(*this, "bytes");
    return *std::get<std::shared_ptr<const Bytes>>(data_);
}

const Value &Value::operator[](std::string_view key) const {
    static const Value null;
    if (!isObject()) return null;
    for (const auto &member : asObject()) {
        if (member.first == key) return member.second;
    }
    return null;
}

std::string Value::json() const {
    std::string out;
    appendJson(out, *this, nullptr);
    return out;
}

const std::string &Call::name() const { return state_->name; }

const Value &Call::options() const { return state_->options; }

bool Call::isFromPage() const { return !state_->isFromApp; }

Page Call::page() const { return app::make<Page>(state_->page, state_->window); }

void Call::resolve(Value result) const {
    double before = 0;
    if (state_->answers(before)) state_->answer(std::nullopt, std::move(result), before);
}

void Call::reject(const std::string &message) const {
    double before = 0;
    if (state_->answers(before)) state_->answer(message, {}, before);
}

void Call::send(Value message) const {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->isAnswered || !state_->message) return;
    state_->sent += 1;
    state_->message(std::move(message));
}

void Call::onCancel(std::function<void()> fn) const {
    {
        std::lock_guard<std::mutex> lock(state_->mutex);
        if (!state_->isCancelled) {
            if (!state_->isAnswered) state_->cancelled.push_back(std::move(fn));
            return;
        }
    }
    fn();
}

Page Window::page() const { return app::pageOfWindow(id_); }

void Events::emit(const std::string &name, const Value &value) const { sendEvent(extension_, name, value, false); }

void Events::emit(const std::string &name, const Value &value, const Page &page) const {
    sendEvent(extension_, name, value, false, app::Reach::onePage, page.id());
}

void Events::emitToFront(const std::string &name, const Value &value) const { sendEvent(extension_, name, value, false, app::Reach::frontPage); }

void Events::hold(const std::string &name, const Value &value) const { sendEvent(extension_, name, value, true); }

std::string Registry::files() const { return resourceDir() + "/ext/" + extension_; }

void Registry::function(const std::string &name, Function fn) {
    checkStarting("the function " + name);
    if (!extension_.empty()) {
        const size_t dot = name.find('.');
        const std::string prefix = dot == std::string::npos || dot + 1 == name.size() ? "" : name.substr(0, dot);
        // One of the host's leaves the functions of a role it gave an app's extension to that one.
        if (holds(given_, prefix)) return;
        if (prefix != extension_ && !holds(roles_, prefix)) {
            throw std::invalid_argument("crossbind: the extension " + extension_ + " names a function " + name + ", where its own start with its name and a dot, as " +
                                        extension_ + "." + name + " does, or with a role's of the host's it takes");
        }
    }
    if (!added().emplace(name, std::move(fn)).second) throw std::logic_error("crossbind: the app has two functions named " + name);
}

void Registry::route(std::function<void(Request)> fn) {
    checkStarting("the extension " + extension_ + "'s route");
    if (extension_.empty()) throw std::logic_error("crossbind: the host's own functions serve no URL: an extension's route does");
    if (!hooks().routes.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls route twice");
}

void Registry::onLaunch(std::function<bool(const Launch &)> fn) {
    checkStarting("the extension " + extension_ + "'s onLaunch");
    Hooks &all = hooks();
    if (all.launch) throw std::logic_error("crossbind: the extensions " + all.launcher + " and " + extension_ + " both take the app's launches, which one alone does");
    all.launcher = extension_;
    all.launch = std::move(fn);
}

void Registry::onStart(std::function<void()> fn) {
    checkStarting("the extension " + extension_ + "'s onStart");
    hooks().starts.emplace_back(extension_, std::move(fn));
}

void Registry::onWindow(std::function<void(const Window &)> fn) {
    checkStarting("the extension " + extension_ + "'s onWindow");
    hooks().windows.emplace_back(extension_, std::move(fn));
}

void Registry::onWindowClosed(std::function<void(const Window &)> fn) {
    checkStarting("the extension " + extension_ + "'s onWindowClosed");
    hooks().closedWindows.emplace_back(extension_, std::move(fn));
}

void Registry::onPage(std::function<void(const Page &)> fn) {
    checkStarting("the extension " + extension_ + "'s onPage");
    hooks().pages.emplace_back(extension_, std::move(fn));
}

void Registry::onClose(std::function<bool(const Window &)> fn) {
    checkStarting("the extension " + extension_ + "'s onClose");
    hooks().closes.emplace_back(extension_, std::move(fn));
}

void Registry::onActive(std::function<void(bool isActive)> fn) {
    checkStarting("the extension " + extension_ + "'s onActive");
    hooks().actives.emplace_back(extension_, std::move(fn));
}

void Registry::onQuitRequest(std::function<bool()> fn) {
    checkStarting("the extension " + extension_ + "'s onQuitRequest");
    hooks().quitRequests.emplace_back(extension_, std::move(fn));
}

void Registry::onReopen(std::function<void()> fn) {
    checkStarting("the extension " + extension_ + "'s onReopen");
    hooks().reopens.emplace_back(extension_, std::move(fn));
}

void Registry::onQuit(std::function<void()> fn) {
    checkStarting("the extension " + extension_ + "'s onQuit");
    hooks().quits.emplace_back(extension_, std::move(fn));
}

// The holder of a role gets the app's own links, files, user activities or quick actions, whatever the app declares.
void Registry::onOpenUrl(std::function<void(const OpenUrl &open)> fn) {
    checkStarting("the extension " + extension_ + "'s onOpenUrl");
    const auto isOwn = [this](const auto &owned) { return owned.second == extension_; };
    const auto schemes = app::urlSchemes();
    const auto links = app::appLinks();
    if (!holds(roles_, "links") && std::none_of(schemes.begin(), schemes.end(), isOwn) && std::none_of(links.begin(), links.end(), isOwn)) {
        throw std::logic_error("crossbind: the extension " + extension_ +
                               " calls onOpenUrl, but declares no scheme in its app.urlSchemes and no link in its app.links whose links it would get");
    }
    if (!hooks().urls.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onOpenUrl twice");
}

void Registry::onOpenFiles(std::function<void(const OpenFiles &open)> fn) {
    checkStarting("the extension " + extension_ + "'s onOpenFiles");
    const auto types = app::fileTypes();
    if (!holds(roles_, "files") && std::none_of(types.begin(), types.end(), [this](const auto &type) { return type.second == extension_; })) {
        throw std::logic_error("crossbind: the extension " + extension_ + " calls onOpenFiles, but its app.fileTypes declares no type whose files it would get");
    }
    if (!hooks().openers.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onOpenFiles twice");
}

void Registry::onUserActivity(std::function<bool(const UserActivity &activity)> fn) {
    checkStarting("the extension " + extension_ + "'s onUserActivity");
    const auto types = app::userActivityTypes();
    if (!holds(roles_, "activities") && std::none_of(types.begin(), types.end(), [this](const auto &type) { return type.second == extension_; })) {
        throw std::logic_error("crossbind: the extension " + extension_ + " calls onUserActivity, but its app.activityTypes declares no type whose activities it would get");
    }
    if (!hooks().activities.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onUserActivity twice");
}

void Registry::onShortcutItem(std::function<bool(const ShortcutItem &item)> fn) {
    checkStarting("the extension " + extension_ + "'s onShortcutItem");
    const auto types = app::shortcutItemTypes();
    if (!holds(roles_, "shortcuts") && std::none_of(types.begin(), types.end(), [this](const auto &type) { return type.second == extension_; })) {
        throw std::logic_error("crossbind: the extension " + extension_ + " calls onShortcutItem, but its app.shortcutItems declares no quick action whose taps it would get");
    }
    if (!hooks().shortcuts.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onShortcutItem twice");
}

void Registry::onNotification(std::function<void(const Notification &notification)> fn) {
    checkStarting("the extension " + extension_ + "'s onNotification");
    hooks().notifications.emplace_back(extension_, std::move(fn));
}

void Registry::onPushToken(std::function<void(const PushToken &token)> fn) {
    checkStarting("the extension " + extension_ + "'s onPushToken");
    hooks().pushTokens.emplace_back(extension_, std::move(fn));
}

void Registry::onPushTokenFailure(std::function<void(const PushTokenFailure &failure)> fn) {
    checkStarting("the extension " + extension_ + "'s onPushTokenFailure");
    hooks().pushFailures.emplace_back(extension_, std::move(fn));
}

void Registry::onPushMessage(std::function<void(const Value &payload, PushDone done)> fn) {
    checkStarting("the extension " + extension_ + "'s onPushMessage");
    hooks().pushMessages.emplace_back(extension_, std::move(fn));
}

const std::string &Notification::id() const { return state_->id; }

const std::string &Notification::title() const { return state_->title; }

const std::string &Notification::body() const { return state_->body; }

const Value &Notification::payload() const { return state_->payload; }

bool Notification::isRemote() const { return state_->isRemote; }

bool Notification::isAnswered() const { return state_->isAnswered; }

bool Notification::isTap() const { return state_->isTap; }

bool Notification::isDismissed() const { return state_->isDismissed; }

const std::string &Notification::action() const { return state_->action; }

void Notification::present(NotificationPresentation presentation) const {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (!state_->presentation) state_->presentation = presentation;
}

namespace {

// The answers of a silent push's handlers, which the platform hears as one once the last has answered, or once the
// wait is over: newData where one gave it, else failed where one gave that, else noData.
struct PushAnswers {
    std::mutex mutex;
    size_t waiting = 0;
    app::PushResult result = app::PushResult::noData;
    std::function<void(app::PushResult)> done;

    void answer(app::PushResult given) {
        std::unique_lock<std::mutex> lock(mutex);
        if (given == app::PushResult::newData || (given == app::PushResult::failed && result == app::PushResult::noData)) result = given;
        waiting -= 1;
        if (waiting == 0) finish(lock);
    }

    void finish() {
        std::unique_lock<std::mutex> lock(mutex);
        finish(lock);
    }

    // Whether some answer is yet to come to a platform that waits for them.
    bool isPending() {
        std::lock_guard<std::mutex> lock(mutex);
        return waiting > 0 && static_cast<bool>(done);
    }

private:
    // done runs once, without the lock, with the answers so far, as a later one may come on its thread meanwhile.
    void finish(std::unique_lock<std::mutex> &lock) {
        if (!done) return;
        const std::function<void(app::PushResult)> finished = std::move(done);
        done = nullptr;
        const app::PushResult outcome = result;
        lock.unlock();
        finished(outcome);
    }
};

// iOS gives a silent push 30 s.
constexpr auto PUSH_WAIT = std::chrono::seconds(25);

}  // namespace

struct PushDone::State {
    explicit State(std::shared_ptr<PushAnswers> answers)
        : answer([answers = std::move(answers)](app::PushResult result) { answers->answer(result); }, app::PushResult::noData) {}

    GivenOnce<app::PushResult> answer;
};

void PushDone::newData() const { state_->answer.give(app::PushResult::newData); }

void PushDone::noData() const { state_->answer.give(app::PushResult::noData); }

void PushDone::failed() const { state_->answer.give(app::PushResult::failed); }

void Registry::onNavigation(std::function<NavigationAnswer(const Navigation &navigation)> fn) {
    takePageRequests(hooks().navigations, std::move(fn), extension_, roles_, given_, "page-navigation", "onNavigation");
}

void Registry::onHttpAuthentication(std::function<void(HttpAuthentication)> fn) {
    takePageRequests(hooks().httpAuthentications, std::move(fn), extension_, roles_, given_, "page-authentication", "onHttpAuthentication");
}

void Registry::onCertificateError(std::function<void(CertificateError)> fn) {
    takePageRequests(hooks().certificateErrors, std::move(fn), extension_, roles_, given_, "page-authentication", "onCertificateError");
}

void Registry::onDownload(std::function<void(Download)> fn) {
    takePageRequests(hooks().downloads, std::move(fn), extension_, roles_, given_, "page-downloads", "onDownload");
}

void Registry::onDrop(std::function<void(const Drop &drop)> fn) {
    takePageRequests(hooks().drops, std::move(fn), extension_, roles_, given_, "page-drops", "onDrop");
}

#if !defined(__ANDROID__)
void Registry::onPageDialog(std::function<void(PageDialog)> fn) {
    takePageRequests(hooks().pageDialogs, std::move(fn), extension_, roles_, given_, "page-dialogs", "onPageDialog");
}

void Registry::onPagePermission(std::function<void(PagePermission)> fn) {
    takePageRequests(hooks().pagePermissions, std::move(fn), extension_, roles_, given_, "page-permissions", "onPagePermission");
}

void Registry::onFileInput(std::function<void(FileInput)> fn) {
    takePageRequests(hooks().fileInputs, std::move(fn), extension_, roles_, given_, "page-files", "onFileInput");
}

PageDialog::Kind PageDialog::kind() const { return state_->kind; }

const std::string &PageDialog::message() const { return state_->message; }

const std::string &PageDialog::defaultText() const { return state_->defaultText; }

Page PageDialog::page() const { return state_->page; }

void PageDialog::accept(const std::string &text) const { state_->answer.give(text); }

void PageDialog::cancel() const { state_->answer.give(std::nullopt); }

void PageDialog::useDefault() const { state_->answer.giveDefault(); }

const std::vector<std::string> &PagePermission::kinds() const { return state_->kinds; }

const std::string &PagePermission::origin() const { return state_->origin; }

bool PagePermission::isListed() const { return state_->isListed; }

Page PagePermission::page() const { return state_->page; }

void PagePermission::allow() const { state_->answer.give(app::PermissionAnswer::allow); }

void PagePermission::deny() const { state_->answer.give(app::PermissionAnswer::deny); }

void PagePermission::useDefault() const { state_->answer.give(app::PermissionAnswer::useDefault); }

bool FileInput::allowsMultiple() const { return state_->allowsMultiple; }

bool FileInput::allowsFolders() const { return state_->allowsFolders; }

const std::vector<std::string> &FileInput::accept() const { return state_->accept; }

Page FileInput::page() const { return state_->page; }

void FileInput::pick(const std::vector<std::string> &paths) const { state_->answer.give(paths); }

void FileInput::cancel() const { state_->answer.give(std::nullopt); }

void FileInput::useDefault() const { state_->answer.giveDefault(); }
#endif

void inBackground(Call call, std::function<Value()> work) {
    std::thread([call = std::move(call), work = std::move(work)] {
        try {
            call.resolve(work());
        } catch (const std::exception &error) {
            call.reject(error.what());
        } catch (...) {
            call.reject("crossbind: " + call.name() + " failed");
        }
    }).detach();
}

void invoke(const std::string &name, Value options, std::function<void(std::optional<std::string> failure, Value result)> done) {
    if (!isSealed) {
        done("crossbind: invoke() reaches the app's functions once its extensions have all started, which their entries do not wait for", {});
        return;
    }
    app::invoke(name, std::move(options), std::move(done));
}

}  // namespace crossbind

void runTask(const std::function<void()> &task) {
    try {
        task();
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: a task on the main thread failed: %s\n", error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: a task on the main thread failed\n");
    }
}

namespace crossbind::app {

namespace {

// What the function of the call's name throws fails the call.
void run(const Call &call) {
    try {
        const Functions &table = added();
        const auto function = table.find(call.name());
        if (function == table.end()) throw std::invalid_argument("crossbind: an app has no function " + call.name());
        function->second(call);
    } catch (const std::exception &error) {
        call.reject(error.what());
    } catch (...) {
        call.reject("crossbind: " + call.name() + " failed");
    }
}

}  // namespace

std::shared_ptr<StateOf<Call>> pageCall(jsi::Runtime &rt, const std::string &name, const jsi::Value &options, PageCall page) {
    auto state = std::make_shared<StateOf<Call>>();
    state->name = name;
    state->answer = std::move(page.answer);
    state->message = std::move(page.message);
    state->page = page.page;
    state->window = page.window;
    try {
        state->options = valueOf(rt, options, 0);
    } catch (const std::exception &error) {
        make<Call>(std::move(state)).reject(error.what());
        return nullptr;
    }
    return state;
}

void runCall(std::shared_ptr<StateOf<Call>> state) { run(make<Call>(std::move(state))); }

bool cancelCall(const std::shared_ptr<StateOf<Call>> &state) {
    std::vector<std::function<void()>> cancelled;
    std::function<void(Value)> sending;
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        if (state->isAnswered) return false;
        state->isAnswered = true;
        state->isCancelled = true;
        cancelled = std::move(state->cancelled);
        sending = std::move(state->message);
    }
    for (const auto &fn : cancelled) {
        try {
            fn();
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the cancel of %s failed: %s\n", state->name.c_str(), error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the cancel of %s failed\n", state->name.c_str());
        }
    }
    return true;
}

void invoke(const std::string &name, Value options, std::function<void(Failure, Value)> done) {
    auto state = std::make_shared<StateOf<Call>>();
    state->name = name;
    state->options = std::move(options);
    state->isFromApp = true;
    state->answer = [done = std::move(done)](Failure failure, Value result, double) { done(std::move(failure), std::move(result)); };
    run(make<Call>(std::move(state)));
}

Value valueOfJson(std::string_view text) { return JsonReader(text).document(); }

std::string jsonWithBytes(const Value &value, std::vector<Value::Bytes> &bytes) {
    std::string out;
    appendJson(out, value, &bytes);
    return out;
}

Value valueWithBytes(std::string_view text, const std::vector<Value::Bytes> &bytes) {
    Value value = JsonReader(text).document();
    return bytes.empty() ? value : withBytes(value, bytes);
}

namespace {

// The bytes from at that make a character of UTF-8, or, where none starts, those that start one as far as they go, as
// the WHATWG decoder reads them: an overlong form, a surrogate and a code point past U+10FFFF start none.
std::pair<size_t, bool> characterAt(const std::string &text, size_t at) {
    const auto byte = [&](size_t i) { return static_cast<unsigned char>(text[i]); };
    const unsigned char lead = byte(at);
    if (lead < 0x80) return {1, true};
    const size_t length = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
    if (length == 0) return {1, false};
    unsigned char lower = lead == 0xe0 ? 0xa0 : lead == 0xf0 ? 0x90 : 0x80;
    unsigned char upper = lead == 0xed ? 0x9f : lead == 0xf4 ? 0x8f : 0xbf;
    size_t taken = 1;
    for (; taken < length && at + taken < text.size(); ++taken) {
        const unsigned char next = byte(at + taken);
        if (next < lower || next > upper) return {taken, false};
        lower = 0x80;
        upper = 0xbf;
    }
    return {taken, taken == length};
}

}  // namespace

std::string validUtf8(const std::string &text) {
    std::string valid;
    valid.reserve(text.size());
    for (size_t at = 0; at < text.size();) {
        const auto [length, isCharacter] = characterAt(text, at);
        if (isCharacter) valid.append(text, at, length);
        else valid += "\xef\xbf\xbd";
        at += length;
    }
    return valid;
}

bool hasFunction(const std::string &name) { return added().count(name) > 0; }

const std::function<void(Request)> *routeOf(const std::string &extension) {
    const auto &routes = hooks().routes;
    const auto route = routes.find(extension);
    return route == routes.end() ? nullptr : &route->second;
}

const std::function<NavigationAnswer(const Navigation &)> &navigationOwner() { return hooks().navigations; }

const std::function<void(HttpAuthentication)> &httpAuthenticationOwner() { return hooks().httpAuthentications; }

const std::function<void(CertificateError)> &certificateErrorOwner() { return hooks().certificateErrors; }

const std::function<void(Download)> &downloadOwner() { return hooks().downloads; }

void startExtension(const char *name, const char *options, void (*entry)(Registry &), std::vector<std::string> roles, std::vector<std::string> given) {
    try {
        for (const auto &role : roles) hooks().holders.emplace(role, name);
        Registry registry = RegistryAccess::of(name, options ? valueOfJson(options) : Value(), std::move(roles), std::move(given));
        entry(registry);
    } catch (const std::exception &error) {
        throw std::runtime_error(std::string("the extension ") + name + " failed to start: " + error.what());
    } catch (...) {
        throw std::runtime_error(std::string("the extension ") + name + " failed to start");
    }
}

std::string holderOf(const std::string &role) {
    const auto holder = hooks().holders.find(role);
    return holder == hooks().holders.end() ? "" : holder->second;
}

void startExtensions() {
    Registry registry = RegistryAccess::host();
    appFunctions(registry);
    extensionEntries();
    refusedFunctions(registry);
    for (const auto &[scheme, owner] : urlSchemes()) {
        if (hooks().urls.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the scheme " + scheme + ", but does not call onOpenUrl, which gets its links");
        }
    }
    for (const auto &[ending, owner] : fileTypes()) {
        if (hooks().openers.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the files ." + ending + ", but does not call onOpenFiles, which gets them");
        }
    }
#if defined(__ANDROID__) || TARGET_OS_IPHONE
    // A desktop's system hands an app no https link, so an extension may leave them to its phones' code.
    for (const auto &[link, owner] : appLinks()) {
        if (hooks().urls.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the links of " + link + ", but does not call onOpenUrl, which gets them");
        }
    }
    // A desktop has no quick actions, so an extension may leave them to its phones' code.
    for (const auto &[type, owner] : shortcutItemTypes()) {
        if (hooks().shortcuts.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the quick action " + type + ", but does not call onShortcutItem, which gets its taps");
        }
    }
#endif
#ifdef __APPLE__
    // Another system continues no user activity, so an extension may leave them to its Apple code.
    for (const auto &[type, owner] : userActivityTypes()) {
        if (hooks().activities.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the user activities " + type + ", but does not call onUserActivity, which gets them");
        }
    }
#endif
    isSealed = true;
}

Launch &firstLaunch() {
    static Launch launch;
    return launch;
}

bool launched(const Launch *launch) {
    if (launch && hooks().launch && !hooks().launch(*launch)) return false;
    isLaunched = true;
    return true;
}

void started() {
    for (const auto &[extension, hook] : hooks().starts) {
        try {
            hook();
        } catch (const std::exception &error) {
            throw std::runtime_error("the extension " + extension + " failed to start: " + error.what());
        } catch (...) {
            throw std::runtime_error("the extension " + extension + " failed to start");
        }
    }
}

namespace {

// Runs each extension's hook of a kind, telling what one throws, after which the others run as well.
template <typename Hook, typename... Args>
void runEach(const std::vector<std::pair<std::string, Hook>> &all, const char *as, const Args &...args) {
    for (const auto &[extension, hook] : all) {
        try {
            hook(args...);
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s: %s\n", extension.c_str(), as, error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s\n", extension.c_str(), as);
        }
    }
}

// Whether every extension's hook of a kind allows it: the first false stops, and one that throws allows it.
template <typename... Args>
bool isAllowedByEach(const std::vector<std::pair<std::string, std::function<bool(const Args &...)>>> &all, const char *as, const Args &...args) {
    for (const auto &[extension, hook] : all) {
        try {
            if (!hook(args...)) return false;
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s: %s\n", extension.c_str(), as, error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s\n", extension.c_str(), as);
        }
    }
    return true;
}

// What the app shows: its open windows, the oldest first, which appWindow() gives, each with the page it shows and the
// name crossbind/app's windows.open() gave it; their ids from the one in front, of the window its user used last; and
// an Android page, of no window. Ids count from 1 within the run.
struct OpenWindow {
    uint64_t id;
    void *native;
    void *webView;
    std::string name;
    uint64_t page = 0;
};
std::mutex shownMutex;
std::vector<OpenWindow> openWindows;
std::vector<uint64_t> frontOrder;
uint64_t windowlessPage = 0;
uint64_t windowCount = 0;
uint64_t pageCount = 0;

Window windowFrom(const OpenWindow &window) { return make<Window>(window.id, window.native, window.webView); }

// A window's event, of its id and its name, for every page that listens.
void tellPages(const char *event, const OpenWindow &window) {
    postEvent(event, Value(Value::Object{{"id", static_cast<double>(window.id)}, {"name", window.name.empty() ? Value() : Value(window.name)}}).json());
}

void tellClosed(const OpenWindow &window) {
    if (hasQuit) return;
    runEach(hooks().closedWindows, "a window closed", windowFrom(window));
    tellPages("window-closed", window);
}

}  // namespace

uint64_t windowOpened(void *window, void *webView, std::string name) {
    OpenWindow opened{0, window, webView, std::move(name)};
    {
        std::lock_guard<std::mutex> lock(shownMutex);
        opened.id = ++windowCount;
        openWindows.push_back(opened);
        frontOrder.insert(frontOrder.begin(), opened.id);
    }
    if (hasQuit) return opened.id;
    runEach(hooks().windows, "a window opened", windowFrom(opened));
    tellPages("window-opened", opened);
    return opened.id;
}

void windowClosed(uint64_t id) {
    std::optional<OpenWindow> closed;
    {
        std::lock_guard<std::mutex> lock(shownMutex);
        const auto open = std::find_if(openWindows.begin(), openWindows.end(), [id](const OpenWindow &window) { return window.id == id; });
        if (open == openWindows.end()) return;
        closed = *open;
        openWindows.erase(open);
        frontOrder.erase(std::remove(frontOrder.begin(), frontOrder.end(), id), frontOrder.end());
    }
    // Its page goes with it.
    closeChannel(id);
    tellClosed(*closed);
}

void windowsClosed() {
    std::vector<OpenWindow> open;
    {
        std::lock_guard<std::mutex> lock(shownMutex);
        open.swap(openWindows);
        frontOrder.clear();
    }
    for (const auto &window : open) tellClosed(window);
}

std::string nameOfWindow(uint64_t id) {
    std::lock_guard<std::mutex> lock(shownMutex);
    for (const auto &open : openWindows) {
        if (open.id == id) return open.name;
    }
    return "";
}

uint64_t frontWindow() {
    std::lock_guard<std::mutex> lock(shownMutex);
    return frontOrder.empty() ? 0 : frontOrder.front();
}

std::vector<uint64_t> frontWindows() {
    std::lock_guard<std::mutex> lock(shownMutex);
    return frontOrder;
}

void windowFocused(uint64_t id) {
    std::lock_guard<std::mutex> lock(shownMutex);
    const auto at = std::find(frontOrder.begin(), frontOrder.end(), id);
    if (at != frontOrder.end()) std::rotate(frontOrder.begin(), at, at + 1);
}

Page newPage(uint64_t window) {
    std::lock_guard<std::mutex> lock(shownMutex);
    const uint64_t page = ++pageCount;
    if (window == 0) windowlessPage = page;
    for (auto &open : openWindows) {
        if (open.id == window) open.page = page;
    }
    return make<Page>(page, window);
}

Page pageOf(const void *webView) {
    std::lock_guard<std::mutex> lock(shownMutex);
    if (!webView) return make<Page>(windowlessPage, uint64_t{0});
    for (const auto &open : openWindows) {
        if (open.webView == webView) return make<Page>(open.page, open.id);
    }
    return make<Page>(uint64_t{0}, uint64_t{0});
}

Page pageOfWindow(uint64_t window) {
    std::lock_guard<std::mutex> lock(shownMutex);
    if (window == 0) return make<Page>(windowlessPage, uint64_t{0});
    for (const auto &open : openWindows) {
        if (open.id == window) return make<Page>(open.page, open.id);
    }
    return make<Page>(uint64_t{0}, uint64_t{0});
}

std::vector<uint64_t> frontPages() {
    std::lock_guard<std::mutex> lock(shownMutex);
    std::vector<uint64_t> pages;
    for (const uint64_t id : frontOrder) {
        for (const auto &open : openWindows) {
            if (open.id == id && open.page != 0) pages.push_back(open.page);
        }
    }
    if (windowlessPage != 0) pages.push_back(windowlessPage);
    return pages;
}

void pageStarted(const Page &page) { runEach(hooks().pages, "a page started", page); }

void droppedFiles(const void *webView, const std::vector<std::string> &paths, double x, double y) {
    const auto &owner = hooks().drops;
    if (!owner || hasQuit) return;
    try {
        owner(Drop{paths, x, y, pageOf(webView)});
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on a drop: %s\n", holderOf("page-drops").c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on a drop\n", holderOf("page-drops").c_str());
    }
}

bool isCloseAllowed(uint64_t window) {
    if (hasQuit) return true;
    std::optional<Window> closing;
    {
        std::lock_guard<std::mutex> lock(shownMutex);
        for (const auto &open : openWindows) {
            if (open.id == window) closing = windowFrom(open);
        }
    }
    return !closing || isAllowedByEach(hooks().closes, "the window closed", *closing);
}

bool isQuitAllowed() { return hasQuit || isAllowedByEach(hooks().quitRequests, "the app was asked to quit"); }

void appActivated(bool isActive) {
    // A platform tells of each window and each switch: the extensions and the page hear of each change once.
    static std::optional<bool> was;
    if (hasQuit || was == isActive) return;
    was = isActive;
    runEach(hooks().actives, isActive ? "the app became active" : "the app became inactive", isActive);
    postEvent(isActive ? "active" : "inactive", "null");
}

void reopened() {
    if (!hasQuit) runEach(hooks().reopens, "the app was opened again");
}

void quitting() {
    if (!isLaunched || hasQuit.exchange(true)) return;
    runEach(hooks().quits, "the app quit");
}

void openUrlOf(const std::string &extension, const std::string &url) {
    const auto hook = hooks().urls.find(extension);
    if (hasQuit || hook == hooks().urls.end()) return;
    try {
        hook->second(OpenUrl{url});
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a link: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a link\n", extension.c_str());
    }
}

void openFilesOf(const std::string &extension, const OpenFiles &files) {
    const auto hook = hooks().openers.find(extension);
    if (hasQuit || hook == hooks().openers.end()) return;
    try {
        hook->second(files);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take the files it opens: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take the files it opens\n", extension.c_str());
    }
}

bool continueActivityOf(const std::string &extension, const UserActivity &activity) {
    const auto hook = hooks().activities.find(extension);
    if (hasQuit || hook == hooks().activities.end()) return false;
    try {
        return hook->second(activity);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a user activity: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a user activity\n", extension.c_str());
    }
    return false;
}

NotificationPresentation notified(std::shared_ptr<StateOf<Notification>> state) {
    if (!hasQuit) runEach(hooks().notifications, "a notification came", make<Notification>(state));
    std::lock_guard<std::mutex> lock(state->mutex);
    return state->presentation.value_or(NotificationPresentation{});
}

void pushTokenArrived(const std::string &hex) {
    if (!hasQuit) runEach(hooks().pushTokens, "the app's push token came", PushToken{hex});
}

void pushTokenFailed(const std::string &message) {
    if (!hasQuit) runEach(hooks().pushFailures, "the app got no push token", PushTokenFailure{message});
}

void pushArrived(const Value &payload, std::function<void(PushResult)> done) {
    const auto &all = hooks().pushMessages;
    if (hasQuit || all.empty()) {
        if (done) done(PushResult::noData);
        return;
    }
    auto answers = std::make_shared<PushAnswers>();
    answers->waiting = all.size();
    answers->done = std::move(done);
    // A hook that throws lets go of its answer, which answers noData.
    for (const auto &[extension, hook] : all) {
        try {
            hook(payload, make<PushDone>(std::make_shared<StateOf<PushDone>>(answers)));
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the extension %s failed on a silent push: %s\n", extension.c_str(), error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the extension %s failed on a silent push\n", extension.c_str());
        }
    }
    // The answers yet to come get the rest of the wait.
    if (!answers->isPending()) return;
    try {
        std::thread([answers] {
            std::this_thread::sleep_for(PUSH_WAIT);
            answers->finish();
        }).detach();
    } catch (const std::system_error &) {
        answers->finish();
    }
}

bool tapShortcutItemOf(const std::string &extension, const std::string &type) {
    const auto hook = hooks().shortcuts.find(extension);
    if (hasQuit || hook == hooks().shortcuts.end()) return false;
    try {
        return hook->second(ShortcutItem{type});
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a quick action's tap: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a quick action's tap\n", extension.c_str());
    }
    return false;
}

#if !defined(__ANDROID__)
namespace {

void refuse(const PageDialog &dialog) { dialog.cancel(); }
void refuse(const PagePermission &request) { request.deny(); }
void refuse(const FileInput &input) { input.cancel(); }

// What the owner throws cancels the request, which an answer the owner gave before keeps as it is: whether the owner
// left it to the webview.
template <typename Asked>
bool askOwner(const std::function<void(Asked)> &owner, const Asked &request, const char *role) {
    try {
        owner(request);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the page's request: %s\n", holderOf(role).c_str(), error.what());
        refuse(request);
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the page's request\n", holderOf(role).c_str());
        refuse(request);
    }
    return stateOf(request)->answer.isLeft();
}

}  // namespace

PagePermission pagePermission(Page page, std::vector<std::string> kinds, std::string origin, std::function<void(PermissionAnswer)> decide) {
    const bool isListed = !kinds.empty() && std::all_of(kinds.begin(), kinds.end(), [](const std::string &kind) {
        return (kind == "camera" && CROSSBIND_APP_PERMISSION_CAMERA) || (kind == "microphone" && CROSSBIND_APP_PERMISSION_MICROPHONE) ||
               (kind == "location" && CROSSBIND_APP_PERMISSION_LOCATION);
    });
    return make<PagePermission>(std::make_shared<StateOf<PagePermission>>(page, std::move(kinds), std::move(origin), isListed, std::move(decide)));
}

bool hasPageDialogs() { return static_cast<bool>(hooks().pageDialogs); }

bool hasPagePermissions() { return static_cast<bool>(hooks().pagePermissions); }

bool hasFileInputs() { return static_cast<bool>(hooks().fileInputs); }

bool askPageDialog(PageDialog dialog) { return askOwner(hooks().pageDialogs, dialog, "page-dialogs"); }

std::vector<std::string> &ownOrigins() {
    static std::vector<std::string> all;
    return all;
}

void setOwnOrigins(std::vector<std::string> origins) { ownOrigins() = std::move(origins); }

bool isOwnOrigin(const std::string &origin) { return std::find(ownOrigins().begin(), ownOrigins().end(), origin) != ownOrigins().end(); }

void askPagePermission(PagePermission request) {
    if (!isOwnOrigin(request.origin())) {
        request.deny();
        return;
    }
    askOwner(hooks().pagePermissions, request, "page-permissions");
}

bool askFileInput(FileInput input) { return askOwner(hooks().fileInputs, input, "page-files"); }
#endif

}  // namespace crossbind::app

#if !defined(__ANDROID__)
namespace crossbind {

void *appWindow() {
    std::lock_guard<std::mutex> lock(app::shownMutex);
    return app::openWindows.empty() ? nullptr : app::openWindows.front().native;
}

void *appWebView() {
    std::lock_guard<std::mutex> lock(app::shownMutex);
    return app::openWindows.empty() ? nullptr : app::openWindows.front().webView;
}

std::optional<Window> windowOf(uint64_t id) {
    std::lock_guard<std::mutex> lock(app::shownMutex);
    for (const auto &open : app::openWindows) {
        if (open.id == id) return app::windowFrom(open);
    }
    return std::nullopt;
}

std::vector<Window> openWindows() {
    std::lock_guard<std::mutex> lock(app::shownMutex);
    std::vector<Window> all;
    for (const auto &open : app::openWindows) all.push_back(app::windowFrom(open));
    return all;
}

void askPagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(bool)> done) {
    onMainThread([kinds = std::move(kinds), origin = std::move(origin), done = std::move(done)]() mutable {
        if (!app::hasPagePermissions()) {
            done(false);
            return;
        }
        app::askPagePermission(app::pagePermission(app::pageOf(nullptr), std::move(kinds), std::move(origin), [done = std::move(done)](app::PermissionAnswer answer) {
            done(answer == app::PermissionAnswer::allow);
        }));
    });
}

}  // namespace crossbind
#endif

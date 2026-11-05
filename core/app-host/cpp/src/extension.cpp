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
#include <sstream>
#include <stdexcept>
#include <thread>

namespace crossbind {

struct Call::State {
    std::string name;
    Value options;
    // A call is the page's, which the scope checks hold to, unless the host's own code made it.
    bool isFromApp = false;
    std::function<void(Failure, Value)> answer;
    std::atomic<bool> isAnswered{false};

    bool answers() { return !isAnswered.exchange(true); }
    // What an answer throws here would end the app, so it is told instead.
    ~State() {
        if (!answers()) return;
        try {
            answer("crossbind: " + name + " gave no answer", {});
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
    return value.isArray() ? "an array" : "an object";
}

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

void appendJson(std::string &out, const Value &value) {
    if (value.isNull()) {
        out += "null";
    } else if (value.isBool()) {
        out += value.asBool() ? "true" : "false";
    } else if (value.isNumber()) {
        out += numberJson(value.asNumber());
    } else if (value.isString()) {
        appendString(out, value.asString());
    } else if (value.isArray()) {
        out += '[';
        for (const Value &item : value.asArray()) {
            if (&item != &value.asArray().front()) out += ',';
            appendJson(out, item);
        }
        out += ']';
    } else {
        out += '{';
        for (const auto &member : value.asObject()) {
            if (&member != &value.asObject().front()) out += ',';
            appendString(out, member.first);
            out += ':';
            appendJson(out, member.second);
        }
        out += '}';
    }
}

// Far deeper than any options: a page that nests more gets an error, not a host that runs out of stack.
constexpr int MAX_DEPTH = 64;

// What the page passed, which came as JSON text; undefined, which JSON.stringify drops, is null.
Value valueOf(jsi::Runtime &rt, const jsi::Value &value, int depth) {
    if (depth > MAX_DEPTH) throw std::invalid_argument("crossbind: the page passed options nested deeper than an app takes");
    if (value.isBool()) return value.getBool();
    if (value.isNumber()) return value.getNumber();
    if (value.isString()) return value.getString(rt).utf8(rt);
    if (!value.isObject()) return {};
    const jsi::Object object = value.getObject(rt);
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

// What the app's extensions do as it is launched, quits and opens their links, each with its extension's name, and
// who takes the page's dialogs, what it asks to use and its file inputs.
struct Hooks {
    std::string launcher;
    std::function<bool(const Launch &)> launch;
    std::vector<std::pair<std::string, std::function<void()>>> windows;
    std::vector<std::pair<std::string, std::function<void()>>> pages;
    std::vector<std::pair<std::string, std::function<bool()>>> closes;
    std::vector<std::pair<std::string, std::function<void(bool)>>> actives;
    std::vector<std::pair<std::string, std::function<bool()>>> quitRequests;
    std::vector<std::pair<std::string, std::function<void()>>> reopens;
    std::vector<std::pair<std::string, std::function<void()>>> quits;
    std::map<std::string, std::function<void(const std::string &)>> urls;
    std::map<std::string, std::function<void(const std::vector<std::string> &)>> openers;
#if !defined(__ANDROID__)
    std::function<void(PageDialog)> pageDialogs;
    std::function<void(PagePermission)> pagePermissions;
    std::function<void(FileInput)> fileInputs;
#endif
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

#if !defined(__ANDROID__)
// The page's own requests go to the extension named for them, the host's or one of the app's in its place.
template <typename Request>
void takePageRequests(std::function<void(Request)> &owner, std::function<void(Request)> fn, const std::string &extension, const char *role,
    const char *hook) {
    checkStarting("the extension " + extension + "'s " + hook);
    if (extension != role) {
        throw std::logic_error(std::string("crossbind: the extension ") + extension + " calls " + hook + ", which the extension named " + role +
                               " alone does: an app's extension of that name takes the host's place");
    }
    if (owner) throw std::logic_error("crossbind: the extension " + extension + " calls " + hook + " twice");
    owner = std::move(fn);
}
#endif

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
    appendJson(out, *this);
    return out;
}

const std::string &Call::name() const { return state_->name; }

const Value &Call::options() const { return state_->options; }

bool Call::isFromPage() const { return !state_->isFromApp; }

void Call::resolve(Value result) const {
    if (state_->answers()) state_->answer(std::nullopt, std::move(result));
}

void Call::reject(const std::string &message) const {
    if (state_->answers()) state_->answer(message, {});
}

namespace {

// Whether an extension's function goes by a name of its own: one that starts with the extension's name and a dot, and
// for the host's menu, which shares its icon with the tray and the notifications on Windows, with theirs.
bool isOwnFunction(const std::string &extension, const std::string &name) {
    std::vector<std::string> prefixes{extension + "."};
    if (extension == "menu") prefixes.insert(prefixes.end(), {"tray.", "notification."});
    return std::any_of(prefixes.begin(), prefixes.end(), [&](const std::string &prefix) {
        return name.size() > prefix.size() && name.compare(0, prefix.size(), prefix) == 0;
    });
}

}  // namespace

void Registry::function(const std::string &name, Function fn) {
    checkStarting("the function " + name);
    if (!extension_.empty() && !isOwnFunction(extension_, name)) {
        throw std::invalid_argument("crossbind: the extension " + extension_ + " names a function " + name + ", where its own start with its name and a dot, as " +
                                    extension_ + "." + name + " does");
    }
    if (!added().emplace(name, std::move(fn)).second) throw std::logic_error("crossbind: the app has two functions named " + name);
}

void Registry::onLaunch(std::function<bool(const Launch &)> fn) {
    checkStarting("the extension " + extension_ + "'s onLaunch");
    Hooks &all = hooks();
    if (all.launch) throw std::logic_error("crossbind: the extensions " + all.launcher + " and " + extension_ + " both take the app's launches, which one alone does");
    all.launcher = extension_;
    all.launch = std::move(fn);
}

void Registry::onWindow(std::function<void()> fn) {
    checkStarting("the extension " + extension_ + "'s onWindow");
    hooks().windows.emplace_back(extension_, std::move(fn));
}

void Registry::onPage(std::function<void()> fn) {
    checkStarting("the extension " + extension_ + "'s onPage");
    hooks().pages.emplace_back(extension_, std::move(fn));
}

void Registry::onClose(std::function<bool()> fn) {
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

void Registry::onUrl(std::function<void(const std::string &url)> fn) {
    checkStarting("the extension " + extension_ + "'s onUrl");
    const auto isOwn = [this](const auto &owned) { return owned.second == extension_; };
    const auto schemes = app::urlSchemes();
    const auto links = app::appLinks();
    if (std::none_of(schemes.begin(), schemes.end(), isOwn) && std::none_of(links.begin(), links.end(), isOwn)) {
        throw std::logic_error("crossbind: the extension " + extension_ + " calls onUrl, but declares no scheme in its app.urlSchemes and no link in its app.links whose links it would get");
    }
    if (!hooks().urls.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onUrl twice");
}

void Registry::onOpenFiles(std::function<void(const std::vector<std::string> &paths)> fn) {
    checkStarting("the extension " + extension_ + "'s onOpenFiles");
    const auto types = app::fileTypes();
    // The files extension gets the files of a type no extension owns as well, whatever types the app declares.
    if (extension_ != "files" && std::none_of(types.begin(), types.end(), [this](const auto &type) { return type.second == extension_; })) {
        throw std::logic_error("crossbind: the extension " + extension_ + " calls onOpenFiles, but its app.fileTypes declares no type whose files it would get");
    }
    if (!hooks().openers.emplace(extension_, std::move(fn)).second) throw std::logic_error("crossbind: the extension " + extension_ + " calls onOpenFiles twice");
}

#if !defined(__ANDROID__)
void Registry::onPageDialog(std::function<void(PageDialog)> fn) {
    takePageRequests(hooks().pageDialogs, std::move(fn), extension_, "page-dialogs", "onPageDialog");
}

void Registry::onPagePermission(std::function<void(PagePermission)> fn) {
    takePageRequests(hooks().pagePermissions, std::move(fn), extension_, "page-permissions", "onPagePermission");
}

void Registry::onFileInput(std::function<void(FileInput)> fn) {
    takePageRequests(hooks().fileInputs, std::move(fn), extension_, "page-files", "onFileInput");
}

PageDialog::Kind PageDialog::kind() const { return state_->kind; }

const std::string &PageDialog::message() const { return state_->message; }

const std::string &PageDialog::defaultText() const { return state_->defaultText; }

void PageDialog::accept(const std::string &text) const { state_->answer.give(text); }

void PageDialog::cancel() const { state_->answer.give(std::nullopt); }

const std::vector<std::string> &PagePermission::kinds() const { return state_->kinds; }

const std::string &PagePermission::origin() const { return state_->origin; }

bool PagePermission::isListed() const { return state_->isListed; }

void PagePermission::allow() const { state_->answer.give(true); }

void PagePermission::deny() const { state_->answer.give(false); }

bool FileInput::allowsMultiple() const { return state_->allowsMultiple; }

bool FileInput::allowsFolders() const { return state_->allowsFolders; }

const std::vector<std::string> &FileInput::accept() const { return state_->accept; }

void FileInput::pick(const std::vector<std::string> &paths) const { state_->answer.give(paths); }

void FileInput::cancel() const { state_->answer.give(std::nullopt); }
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

void callApp(jsi::Runtime &rt, const std::string &name, const jsi::Value &options, ReplyFn reply) {
    auto state = std::make_shared<Call::State>();
    state->name = name;
    state->answer = [reply = std::move(reply)](Failure failure, Value result) {
        reply(failure ? errorReply(*failure) : "[0," + result.json() + "]");
    };
    try {
        state->options = valueOf(rt, options, 0);
    } catch (const std::exception &error) {
        Call(state).reject(error.what());
        return;
    }
    run(Call(std::move(state)));
}

void invoke(const std::string &name, Value options, std::function<void(Failure, Value)> done) {
    auto state = std::make_shared<Call::State>();
    state->name = name;
    state->options = std::move(options);
    state->isFromApp = true;
    state->answer = std::move(done);
    run(Call(std::move(state)));
}

Value valueOfJson(std::string_view text) { return JsonReader(text).document(); }

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

// The host alone makes a registry: its own, and one for each extension's entry.
struct RegistryAccess {
    static Registry host() { return Registry(); }
    static Registry of(std::string extension, Value options) { return Registry(std::move(extension), std::move(options)); }
};

void startExtension(const char *name, const char *options, void (*entry)(Registry &)) {
    try {
        Registry registry = RegistryAccess::of(name, options ? valueOfJson(options) : Value());
        entry(registry);
    } catch (const std::exception &error) {
        throw std::runtime_error(std::string("the extension ") + name + " failed to start: " + error.what());
    } catch (...) {
        throw std::runtime_error(std::string("the extension ") + name + " failed to start");
    }
}

void startExtensions() {
    Registry registry = RegistryAccess::host();
    appFunctions(registry);
    extensionEntries();
    refusedFunctions(registry);
    for (const auto &[scheme, owner] : urlSchemes()) {
        if (hooks().urls.count(owner) == 0) {
            throw std::runtime_error("the extension " + owner + " owns the scheme " + scheme + ", but does not call onUrl, which gets its links");
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
            throw std::runtime_error("the extension " + owner + " owns the links of " + link + ", but does not call onUrl, which gets them");
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
bool isAllowedByEach(const std::vector<std::pair<std::string, std::function<bool()>>> &all, const char *as) {
    for (const auto &[extension, hook] : all) {
        try {
            if (!hook()) return false;
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s: %s\n", extension.c_str(), as, error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the extension %s failed as %s\n", extension.c_str(), as);
        }
    }
    return true;
}

}  // namespace

void windowOpened() { runEach(hooks().windows, "the window opened"); }

void pageStarted() { runEach(hooks().pages, "a page started"); }

bool isCloseAllowed() { return hasQuit || isAllowedByEach(hooks().closes, "the window closed"); }

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
        hook->second(url);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a link: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take a link\n", extension.c_str());
    }
}

void openFilesOf(const std::string &extension, const std::vector<std::string> &paths) {
    const auto hook = hooks().openers.find(extension);
    if (hasQuit || hook == hooks().openers.end()) return;
    try {
        hook->second(paths);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s did not take the files it opens: %s\n", extension.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s did not take the files it opens\n", extension.c_str());
    }
}

#if !defined(__ANDROID__)
namespace {

void refuse(const PageDialog &dialog) { dialog.cancel(); }
void refuse(const PagePermission &request) { request.deny(); }
void refuse(const FileInput &input) { input.cancel(); }

// What the owner throws cancels the request, which an answer the owner gave before keeps as it is.
template <typename Request>
void askOwner(const std::function<void(Request)> &owner, const Request &request, const char *role) {
    try {
        owner(request);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the page's request: %s\n", role, error.what());
        refuse(request);
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the page's request\n", role);
        refuse(request);
    }
}

}  // namespace

PagePermission pagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(bool)> decide) {
    const bool isListed = !kinds.empty() && std::all_of(kinds.begin(), kinds.end(), [](const std::string &kind) {
        return (kind == "camera" && CROSSBIND_APP_PERMISSION_CAMERA) || (kind == "microphone" && CROSSBIND_APP_PERMISSION_MICROPHONE) ||
               (kind == "location" && CROSSBIND_APP_PERMISSION_LOCATION);
    });
    return PagePermission(std::make_shared<PagePermission::State>(std::move(kinds), std::move(origin), isListed, std::move(decide)));
}

bool hasPageDialogs() { return static_cast<bool>(hooks().pageDialogs); }

bool hasPagePermissions() { return static_cast<bool>(hooks().pagePermissions); }

bool hasFileInputs() { return static_cast<bool>(hooks().fileInputs); }

void askPageDialog(PageDialog dialog) { askOwner(hooks().pageDialogs, dialog, "page-dialogs"); }

void askPagePermission(PagePermission request) { askOwner(hooks().pagePermissions, request, "page-permissions"); }

void askFileInput(FileInput input) { askOwner(hooks().fileInputs, input, "page-files"); }
#endif

}  // namespace crossbind::app

#if !defined(__ANDROID__)
namespace crossbind {

void askPagePermission(std::vector<std::string> kinds, std::string origin, std::function<void(bool)> done) {
    onMainThread([kinds = std::move(kinds), origin = std::move(origin), done = std::move(done)]() mutable {
        if (!app::hasPagePermissions()) {
            done(false);
            return;
        }
        app::askPagePermission(app::pagePermission(std::move(kinds), std::move(origin), std::move(done)));
    });
}

}  // namespace crossbind
#endif

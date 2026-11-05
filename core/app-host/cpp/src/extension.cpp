// The page's calls of the app's functions (<crossbind/extension.h>): what the page passed as a JSON value, the function
// of the name it called, and the answer. Also the JSON an Android extension's Java answers with.
#include "crossbind/extension.h"
#include "host_core.h"

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
    std::function<void(Failure, Value)> answer;
    std::atomic<bool> isAnswered{false};

    bool answers() { return !isAnswered.exchange(true); }
    ~State() {
        if (answers()) answer("crossbind: " + name + " gave no answer", {});
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
    for (const unsigned char c : text) {
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

// The functions the page may call, added once, before its first call.
const Functions &functions() {
    static const bool isAdded = [] {
        Registry registry;
        app::appFunctions(registry);
        app::extensionFunctions(registry);
        isSealed = true;
        return true;
    }();
    (void)isAdded;
    return added();
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

void Call::resolve(Value result) const {
    if (state_->answers()) state_->answer(std::nullopt, std::move(result));
}

void Call::reject(const std::string &message) const {
    if (state_->answers()) state_->answer(message, {});
}

void Registry::function(const std::string &name, Function fn) {
    if (isSealed) throw std::logic_error("crossbind: the app's functions are added before the page calls one, and " + name + " came after");
    if (!added().emplace(name, std::move(fn)).second) throw std::logic_error("crossbind: the app has two functions named " + name);
}

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

}  // namespace crossbind

namespace crossbind::app {

namespace {

// What the function of the call's name throws fails the call.
void run(const Call &call) {
    try {
        const Functions &table = functions();
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
    state->answer = std::move(done);
    run(Call(std::move(state)));
}

Value valueOfJson(std::string_view text) { return JsonReader(text).document(); }

}  // namespace crossbind::app

#pragma once

// What an app's host gives the native code it compiles in: functions the page calls by name through crossbind/app,
// whose options and results are JSON values. The host's own functions are added the same way.
#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace crossbind {

// A JSON value. It never changes, so any thread may hold a copy.
class Value {
public:
    using Array = std::vector<Value>;
    // The members in their order, as JSON.stringify writes them.
    using Object = std::vector<std::pair<std::string, Value>>;

    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool value) : data_(value) {}
    Value(int value) : data_(static_cast<double>(value)) {}
    Value(double value) : data_(value) {}
    Value(const char *text) : data_(std::string(text)) {}
    Value(std::string text) : data_(std::move(text)) {}
    Value(const std::vector<std::string> &texts) : Value(Array(texts.begin(), texts.end())) {}
    Value(Array items) : data_(std::make_shared<const Array>(std::move(items))) {}
    Value(Object members) : data_(std::make_shared<const Object>(std::move(members))) {}

    bool isNull() const { return std::holds_alternative<std::monostate>(data_); }
    bool isBool() const { return std::holds_alternative<bool>(data_); }
    bool isNumber() const { return std::holds_alternative<double>(data_); }
    bool isString() const { return std::holds_alternative<std::string>(data_); }
    bool isArray() const { return std::holds_alternative<std::shared_ptr<const Array>>(data_); }
    bool isObject() const { return std::holds_alternative<std::shared_ptr<const Object>>(data_); }

    // Each throws when the value is of another kind; given a fallback, it returns that for null.
    bool asBool() const;
    bool asBool(bool fallback) const;
    double asNumber() const;
    double asNumber(double fallback) const;
    const std::string &asString() const;
    std::string asString(std::string fallback) const;
    const Array &asArray() const;
    const Object &asObject() const;
    // An object's member, or null when it has none or is no object.
    const Value &operator[](std::string_view key) const;
    std::string json() const;

private:
    std::variant<std::monostate, bool, double, std::string, std::shared_ptr<const Array>, std::shared_ptr<const Object>> data_;
};

// A call of the page's, which its function answers once, from any thread: with a result, or with why it failed. A call
// that every copy lets go of unanswered fails.
class Call {
public:
    struct State;
    explicit Call(std::shared_ptr<State> state) : state_(std::move(state)) {}

    const std::string &name() const;
    const Value &options() const;
    void resolve(Value result = {}) const;
    void reject(const std::string &message) const;

private:
    std::shared_ptr<State> state_;
};

// Where the page's functions are added, before the page first calls one.
class Registry {
public:
    using Function = std::function<void(Call)>;

    // A function the page calls by this name. It runs on the module's thread, which it must not hold up: it answers
    // there, or hands the call on, as to inBackground(). What it throws fails the call.
    void function(const std::string &name, Function fn);
};

// Runs work on a thread of its own, which answers the call with what work returns, or with what it throws.
void inBackground(Call call, std::function<Value()> work);

// The app's name, as its window and dialogs show it.
std::string appName();

// The page may reach this file or folder, and what is in a folder, through crossbind/app's shell functions from now
// on, as what its user picked: openPath() where app.openPath lists picked, revealInFolder() and trash().
void allowPath(const std::string &path);

#if !defined(__ANDROID__)
// Runs fn on the app's main thread, where the platform's UI is called.
void onMainThread(std::function<void()> fn);

// The app's window, on the main thread: an NSWindow on macOS, a UIWindow on iOS, a GtkWindow on Linux and an HWND on
// Windows; null before it has one.
void *appWindow();
#endif

#if defined(__ANDROID__)
namespace android {

// Calls a function of the extension's Java, the class its app.android.class names, on the UI thread with the app's
// activity. done gets the answer once, on the thread that gives it: why the call failed, or its result.
void callJava(const std::string &extension, const std::string &function, Value::Object options,
    std::function<void(std::optional<std::string> failure, Value result)> done);

}  // namespace android
#endif

}  // namespace crossbind

// Android's own for the preview extension, which its Java does, as the NDK gives no crypto of the system's: a key of the
// Android Keystore seals the app's token, javax.crypto makes HMAC-SHA256 and SHA-256, a Custom Tab shows the page that
// approves a sign-in, and a pill above the WebView shows that a preview is one, with its menu and Back
// (Indicator.java).
#include "preview.h"

#include <sys/system_properties.h>

#include <atomic>
#include <cstdlib>

namespace preview {
namespace {

Value bytesOf(const std::string &text) { return Value(Value::Bytes(text.begin(), text.end())); }

std::string textOfBytes(const Value &value) {
    if (!value.isBytes()) return {};
    const Value::Bytes &bytes = value.asBytes();
    return std::string(bytes.begin(), bytes.end());
}

void inJava(const std::string &function, Value::Object options, std::function<void(Failure failure, Value result)> done) {
    crossbind::android::callJava("preview", function, std::move(options), std::move(done));
}

// Whether the Java holds a call of the native code's for what its user asks of the preview next.
std::atomic<bool> isListening{false};

}  // namespace

void hmacSha256(const std::string &key, const std::string &text, Digest done) {
    inJava("hmac", {{"key", bytesOf(key)}, {"text", bytesOf(text)}}, [done](Failure failure, Value digest) { done(failure, textOfBytes(digest)); });
}

void sha256(const std::string &text, Digest done) {
    inJava("sha256", {{"text", bytesOf(text)}}, [done](Failure failure, Value digest) { done(failure, textOfBytes(digest)); });
}

std::string randomBytes(std::size_t count) {
    std::string bytes(count, '\0');
    arc4random_buf(bytes.data(), count);
    return bytes;
}

void readSecret(const std::string &cloud, std::function<void(Failure failure, std::optional<std::string> secret)> done) {
    inJava("readSecret", {{"cloud", cloud}}, [done](Failure failure, Value secret) {
        if (failure) done(failure, std::nullopt);
        else done(std::nullopt, secret.isString() ? std::optional<std::string>(secret.asString()) : std::nullopt);
    });
}

void writeSecret(const std::string &cloud, const std::string &secret, Done done) {
    inJava("writeSecret", {{"cloud", cloud}, {"secret", secret}}, [done](Failure failure, Value) { done(failure); });
}

void deleteSecret(const std::string &cloud, Done done) {
    inJava("deleteSecret", {{"cloud", cloud}}, [done](Failure failure, Value) { done(failure); });
}

void openSignInPage(const std::string &url, Done done) {
    inJava("openSignInPage", {{"url", url}}, [done](Failure failure, Value) { done(failure); });
}

std::string platformName() { return "android"; }

// Android's version as its settings show it, as "16"; 0 where it names none in numbers.
std::string systemVersion() {
    char release[PROP_VALUE_MAX] = {};
    __system_property_get("ro.build.version.release", release);
    const std::string version(release);
    if (version.empty() || version.find_first_not_of("0123456789.") != std::string::npos || version.front() == '.' || version.back() == '.') return "0";
    return version;
}

bool asksForLocalNetwork() { return false; }

void showIndicator(uint64_t, const Shown &shown, std::function<void()> done) {
    if (!isListening) listenToMenu();
    inJava("mark", {{"project", shown.project}, {"line", shown.line}, {"origin", shown.origin}}, [done](Failure, Value) { done(); });
}

void hideIndicator(uint64_t) {
    inJava("unmark", {}, [](Failure, Value) {});
}

void endIndicator(uint64_t, std::function<void(bool isShowingProject)> done) {
    inJava("showsPreview", {}, [done](Failure failure, Value isShowing) { done(!failure && isShowing.asBool(false)); });
}

void reloadWindow(uint64_t) {
    inJava("reload", {}, [](Failure, Value) {});
}

// The pill's menu and Back ask for Reload and Close preview one at a time; the Java answers the call it holds with each.
void listenToMenu() {
    if (isListening.exchange(true)) return;
    inJava("next", {}, [](Failure failure, Value asked) {
        isListening = false;
        if (failure) return;
        listenToMenu();
        const std::string action = asked.isString() ? asked.asString() : "";
        if (action == "reload") reloadPreview();
        if (action == "close") closePreview();
    });
}

}  // namespace preview

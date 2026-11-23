// What the probe adds on Android: its Java's account of what the app took of the probe's manifest and resources, the
// app's static shortcuts and their taps, and an answer whose done throws, which the app outlives.
#include "probe.h"

#include <optional>
#include <stdexcept>
#include <string>

void closeMessageDialog(const std::string &message, std::function<void(bool, const std::string &)> done) {
    crossbind::android::callJava("probe", "closeDialog", crossbind::Value::Object{{"message", message}},
        [done](std::optional<std::string> failure, crossbind::Value result) { done(!failure && result.asBool(false), ""); });
}

void probePlatform(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.function("probe.android", [](Call call) {
        crossbind::android::callJava("probe", "android", {}, [call](std::optional<std::string> failure, Value result) {
            if (failure) call.reject(*failure);
            else call.resolve(std::move(result));
        });
    });
    registry.function("probe.javaThrows", [](Call call) {
        crossbind::android::callJava("probe", "echo", {}, [call](std::optional<std::string>, Value) {
            throw std::runtime_error("the probe's answer fails");
        });
    });
    // The calls of probe.cpp, which its Java takes whole: their options, messages, cancels and answers.
    registry.function("probe.javaCount", [](Call call) { crossbind::android::callJava("probe", "count", call); });
    registry.function("probe.javaWait", [](Call call) { crossbind::android::callJava("probe", "wait", call); });
    registry.function("probe.javaCancels", [](Call call) { crossbind::android::callJava("probe", "cancels", call); });
    registry.function("probe.javaBytes", [](Call call) { crossbind::android::callJava("probe", "bytes", call); });
    registry.function("probe.shortcuts", [](Call call) { crossbind::android::callJava("probe", "shortcuts", call); });
    registry.function("probe.tapShortcut", [](Call call) { crossbind::android::callJava("probe", "tapShortcut", call); });
    // The UI thread's Java messages wait ms, as the page opens one the host hears of only then.
    registry.function("probe.holdUi", [](Call call) { crossbind::android::callJava("probe", "holdUi", call); });
    // A tap amid the page, which gives it its user's activation.
    registry.function("probe.tapWebView", [](Call call) { crossbind::android::callJava("probe", "tapWebView", call); });
    // The close the dialog extension sends for a message dialog that is not the one shown, as for a call whose dialog
    // was answered just as another call's showed: the extension numbers its dialogs from 1.
    registry.function("probe.closeAnotherMessage", {"app", "project"}, [](Call call) {
        crossbind::android::callJava("dialog", "closeMessage", Value::Object{{"id", 0}}, [call](std::optional<std::string> failure, Value) {
            if (failure) call.reject(*failure);
            else call.resolve();
        });
    });
}

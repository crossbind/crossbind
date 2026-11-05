// What the probe adds on Android: its Java's account of what the app took of the probe's manifest and resources, the
// app's static shortcuts and their taps, and an answer whose done throws, which the app outlives.
#include "probe.h"

#include <optional>
#include <stdexcept>
#include <string>

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
}

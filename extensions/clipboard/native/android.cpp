#include "clipboard.h"

#include <optional>
#include <utility>

namespace crossbind::clipboard {
namespace {

// The extension's Java answers the call.
void viaJava(const std::string &function, Value::Object options, Call call) {
    android::callJava("clipboard", function, std::move(options), [call = std::move(call)](std::optional<std::string> failure, Value result) {
        if (failure) {
            call.reject(*failure);
        } else {
            call.resolve(std::move(result));
        }
    });
}

}  // namespace

void readText(Call call) { viaJava("readText", {}, std::move(call)); }

void writeText(Call call, std::string text) { viaJava("writeText", {{"text", std::move(text)}}, std::move(call)); }

}  // namespace crossbind::clipboard

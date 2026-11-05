// What the page asks to use: the clipboard alone is allowed, which e2e/run.mjs reads on Windows, and the rest denied,
// as src/main.js asks for the location. page-permissions.asked gives what each request asked for; on Android the
// extension's Java takes the requests and keeps them.
#include "crossbind/extension.h"

#include <optional>
#include <string>
#include <utility>

#if defined(__ANDROID__)
void crossbind_extension_page_permissions(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.function("page-permissions.asked", [](Call call) {
        crossbind::android::callJava("page-permissions", "asked", {}, [call](std::optional<std::string> failure, Value asked) {
            if (failure) {
                call.reject(*failure);
            } else {
                call.resolve(std::move(asked));
            }
        });
    });
}
#else
#include <mutex>
#include <vector>

namespace {

std::mutex askedMutex;
crossbind::Value::Array asked;

}  // namespace

void crossbind_extension_page_permissions(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.onPagePermission([](const crossbind::PagePermission &request) {
        {
            std::lock_guard<std::mutex> lock(askedMutex);
            asked.emplace_back(Value::Object{{"kinds", request.kinds()}, {"origin", request.origin()}, {"isListed", request.isListed()}});
        }
        if (request.kinds() == std::vector<std::string>{"clipboard"}) {
            request.allow();
        } else {
            request.deny();
        }
    });
    registry.function("page-permissions.asked", [](Call call) {
        std::lock_guard<std::mutex> lock(askedMutex);
        call.resolve(Value(asked));
    });
}
#endif

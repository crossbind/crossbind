// What a page asks to use and the files dropped on it, which the extension takes from the host's page-permissions and
// page-drops, by the page's role: the app's own page gets what the host's own give it; a project's page the camera,
// the microphone and the location its user allows at the extension's own question (consents.cpp) and nothing else, and
// no path of a drop, its page's own drop event keeping its files; a page of no role nothing. Android's requests are its
// Java's (PreviewExtension.java).
#include "preview.h"

#include "crossbind/app.h"

namespace preview {
namespace {

using crossbind::Value;

constexpr char APP_ROLE[] = "app";

}  // namespace

void addPageRequests(crossbind::Registry &registry) {
#if !defined(__ANDROID__)
    // The devices app.permissions lists, and the clipboard's text, which a webview asks for on its user's gesture alone.
    registry.onPagePermission([](crossbind::PagePermission request) {
        const std::string role = request.page().role();
        if (role.empty()) {
            request.deny();
        } else if (role != APP_ROLE) {
            askConsent(std::move(request));
        } else {
            const auto &kinds = request.kinds();
            const bool isClipboard = kinds.size() == 1 && kinds.front() == "clipboard";
            if (request.isListed() || isClipboard) request.allow();
            else request.deny();
        }
    });
#endif
#if !defined(__ANDROID__) && !(defined(__APPLE__) && TARGET_OS_IPHONE)
    registry.onDrop([](const crossbind::Drop &drop) {
        if (drop.page.role() != APP_ROLE) return;
        Value::Array listed;
        for (const auto &path : drop.paths) {
            crossbind::allowPath(path);
            listed.emplace_back(path);
        }
        const Value value(Value::Object{{"paths", Value(std::move(listed))}, {"x", drop.x}, {"y", drop.y}});
        crossbind::app::emitEvent("drop", value.json(), drop.page.id());
    });
#endif
}

}  // namespace preview

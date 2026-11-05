// A download whose name starts with cancel is cancelled, and any other saved in the app's cache folder without asking;
// page-downloads.ended gives how each ended: why it was not saved, or where it was and the text it holds.
#include "crossbind/app.h"
#include "crossbind/extension.h"

#include <fstream>
#include <mutex>
#include <sstream>

namespace {

#ifdef _WIN32
constexpr const char *SEPARATOR = "\\";
#else
constexpr const char *SEPARATOR = "/";
#endif

std::mutex endedMutex;
crossbind::Value::Array ended;

std::string textOf(const std::string &path) {
    std::ifstream file(path, std::ios::binary);
    std::ostringstream text;
    text << file.rdbuf();
    return text.str();
}

}  // namespace

void crossbind_extension_e2e_page_downloads(crossbind::Registry &registry) {
    using crossbind::Call;
    using crossbind::Value;
    registry.onDownload([](const crossbind::Download &download) {
        const std::string name = download.suggestedName();
        const std::string mimeType = download.mimeType();
        download.onFinish([name, mimeType](const crossbind::DownloadEnd &end) {
            const std::string text = end.path.empty() ? "" : textOf(end.path);
            std::lock_guard<std::mutex> lock(endedMutex);
            ended.emplace_back(Value::Object{{"name", name}, {"mimeType", mimeType}, {"isCancelled", end.isCancelled},
                {"failure", end.failure ? Value(*end.failure) : Value()}, {"path", end.path}, {"text", text}});
        });
        if (name.rfind("cancel", 0) == 0) {
            download.cancel();
        } else {
            download.saveTo(crossbind::app::paths().cache + SEPARATOR + name);
        }
    });
    registry.function("page-downloads.ended", [](Call call) {
        std::lock_guard<std::mutex> lock(endedMutex);
        call.resolve(Value(ended));
    });
}

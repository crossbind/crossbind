// What shows that a preview is one, on each window a project's page shows in: up before the project's page can load
// in its window, and down once the preview ended and the window's next page that is no project's started, so that no
// project's page shows without it. Each mark is its preview's, as serve() numbers them: an end or a line of another
// preview changes nothing of it. A window that comes to show a project's page some other way carries it as well, and
// the app's own page that comes to show in a window whose preview is open ends that preview, however it came. Each
// platform's call only posts its work to the main thread, so it is made under the lock that decided it: the main
// thread runs the calls of two threads in the order they were decided in.
#include "preview.h"

#include <map>
#include <mutex>

namespace preview {
namespace {

const std::string APP_ROLE = "app";
const std::string PROJECT_ROLE = "project";

// A window's indicator: the preview it is of, and whether that preview ended.
struct Mark {
    uint64_t preview = 0;
    bool isEnding = false;
};

std::mutex indicatorMutex;
// The preview open, by its number, and its words; none while none is.
uint64_t shownPreview = 0;
std::optional<Shown> shown;
std::map<uint64_t, Mark> marked;

uint64_t windowFor(uint64_t window) {
#if defined(__ANDROID__)
    return 0;
#else
    if (window != 0) return window;
    const std::vector<crossbind::Window> open = crossbind::openWindows();
    return open.empty() ? 0 : open.front().id();
#endif
}

void pageStarted(const crossbind::Page &page) {
    const uint64_t window = page.windowId();
    bool isEnding = false;
    {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        const auto found = marked.find(window);
        if (found != marked.end() && found->second.isEnding) {
            // A project's page that started before its preview's end and is told after it still shows.
            if (page.role() != PROJECT_ROLE) {
                marked.erase(found);
                hideIndicator(window);
            }
        } else if (found != marked.end() && page.role() == APP_ROLE) {
            isEnding = true;
        } else if (found == marked.end() && shown && page.role() == PROJECT_ROLE) {
            marked[window] = {shownPreview, false};
            showIndicator(window, *shown, [] {});
        }
    }
    // The end takes the lock itself.
    if (isEnding) closePreview();
}

}  // namespace

void markPreview(uint64_t preview, uint64_t window, Shown words, std::function<void(uint64_t window)> then) {
    const uint64_t on = windowFor(window);
    std::lock_guard<std::mutex> lock(indicatorMutex);
    shownPreview = preview;
    shown = words;
    marked[on] = {preview, false};
    showIndicator(on, words, [on, then] { then(on); });
}

void unmarkPreview(uint64_t preview) {
    std::lock_guard<std::mutex> lock(indicatorMutex);
    if (shownPreview == preview) {
        shownPreview = 0;
        shown.reset();
    }
    for (auto &[window, mark] : marked) {
        if (mark.preview != preview || mark.isEnding) continue;
        mark.isEnding = true;
        endIndicator(window, [window, preview](bool isShowingProject) {
            std::lock_guard<std::mutex> lock(indicatorMutex);
            const auto found = marked.find(window);
            // Up again for the next preview meanwhile, or down already with the window's next page.
            if (found == marked.end() || found->second.preview != preview || !found->second.isEnding || isShowingProject) return;
            marked.erase(found);
            hideIndicator(window);
        });
    }
}

void relineIndicator(uint64_t preview, std::string line) {
    std::lock_guard<std::mutex> lock(indicatorMutex);
    if (!shown || shownPreview != preview) return;
    shown->line = std::move(line);
    for (const auto &[window, mark] : marked) {
        if (mark.preview == preview && !mark.isEnding) showIndicator(window, *shown, [] {});
    }
}

void addIndicatorHooks(crossbind::Registry &registry) {
    registry.onPage(pageStarted);
#if defined(__ANDROID__)
    registry.onStart(listenToMenu);
#else
    registry.onWindowClosed([](const crossbind::Window &window) {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        marked.erase(window.id());
        hideIndicator(window.id());
    });
#endif
    registry.onActive([](bool isActive) {
        if (isActive) readPreviewAgain();
    });
}

}  // namespace preview

// What shows that a preview is one, on each window a project's page shows in: up before the project's page can load
// in its window, and down once the preview ended and the window's next page started, so that no project's page shows
// without it. A window that comes to show a project's page some other way carries it as well, and the app's own page
// that comes to show in a window whose preview is open ends that preview, however it came.
#include "preview.h"

#include <map>
#include <mutex>

namespace preview {
namespace {

const std::string APP_ROLE = "app";
const std::string PROJECT_ROLE = "project";

std::mutex indicatorMutex;
// The words of the preview open; none while none is.
std::optional<Shown> shown;
// The windows its indicator is up on, true for one whose preview ended, which comes down with the window's next page.
std::map<uint64_t, bool> marked;

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
    enum class Then { nothing, hide, end, mark } then = Then::nothing;
    Shown words;
    {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        const auto found = marked.find(window);
        if (found != marked.end() && found->second) {
            marked.erase(found);
            then = Then::hide;
        } else if (found != marked.end() && page.role() == APP_ROLE) {
            then = Then::end;
        } else if (found == marked.end() && shown && page.role() == PROJECT_ROLE) {
            marked[window] = false;
            words = *shown;
            then = Then::mark;
        }
    }
    if (then == Then::hide) hideIndicator(window);
    if (then == Then::end) closePreview();
    if (then == Then::mark) showIndicator(window, words, [] {});
}

}  // namespace

void markPreview(uint64_t window, Shown words, std::function<void(uint64_t window)> then) {
    const uint64_t on = windowFor(window);
    {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        shown = words;
        marked[on] = false;
    }
    showIndicator(on, words, [on, then] { then(on); });
}

void unmarkPreview() {
    std::vector<uint64_t> windows;
    {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        shown.reset();
        for (auto &[window, isEnding] : marked) {
            isEnding = true;
            windows.push_back(window);
        }
    }
    for (const uint64_t window : windows) {
        endIndicator(window, [window](bool isShowingProject) {
            {
                std::lock_guard<std::mutex> lock(indicatorMutex);
                const auto found = marked.find(window);
                // Up again for the next preview meanwhile, or down already with the window's next page.
                if (found == marked.end() || !found->second || isShowingProject) return;
                marked.erase(found);
            }
            hideIndicator(window);
        });
    }
}

void relineIndicator(std::string line) {
    std::vector<uint64_t> windows;
    Shown words;
    {
        std::lock_guard<std::mutex> lock(indicatorMutex);
        if (!shown) return;
        shown->line = std::move(line);
        words = *shown;
        for (const auto &[window, isEnding] : marked) {
            if (!isEnding) windows.push_back(window);
        }
    }
    for (const uint64_t window : windows) showIndicator(window, words, [] {});
}

void addIndicatorHooks(crossbind::Registry &registry) {
    registry.onPage(pageStarted);
#if defined(__ANDROID__)
    registry.onStart(listenToMenu);
#else
    registry.onWindowClosed([](const crossbind::Window &window) {
        {
            std::lock_guard<std::mutex> lock(indicatorMutex);
            marked.erase(window.id());
        }
        hideIndicator(window.id());
    });
#endif
    registry.onActive([](bool isActive) {
        if (isActive) readPreviewAgain();
    });
}

}  // namespace preview

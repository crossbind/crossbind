#include "crossbind/extension.h"
#include "crossbind_app.h"
#include "desktop.h"
#include "linux/main_thread.h"
#include "platform.h"

#include <gtk/gtk.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <cerrno>
#include <cstdlib>
#include <stdexcept>

namespace {

// An XDG base directory: the variable's absolute path, else the default under the home folder.
std::string baseDirectory(const char *variable, const char *underHome) {
    const char *set = std::getenv(variable);
    if (set && *set == '/') return set;
    return std::string(g_get_home_dir()) + underHome;
}

std::string made(const std::string &path) {
    if (g_mkdir_with_parents(path.c_str(), 0700) != 0) {
        throw std::runtime_error("crossbind: cannot make the app's folder " + path + ": " + g_strerror(errno));
    }
    return path;
}

}  // namespace

crossbind::app::Paths appPaths() {
    const std::string id = CROSSBIND_APP_ID;
    return {made(baseDirectory("XDG_DATA_HOME", "/.local/share") + "/" + id), made(baseDirectory("XDG_CACHE_HOME", "/.cache") + "/" + id),
            made(baseDirectory("XDG_STATE_HOME", "/.local/state") + "/" + id + "/logs")};
}

void crossbind::onMainThread(std::function<void()> fn) { ::onMainThread(std::move(fn)); }

// The process's first thread runs GTK; the image's glibc predates gettid().
bool isMainThread() { return syscall(SYS_gettid) == getpid(); }

// The windows go without asking the app's extensions, as the app quits once the loop ends.
void quitApp() {
    onMainThread([] { endLoop(); });
}

void setBackgroundColor(void *, void *view, std::uint32_t color) {
    const GdkRGBA rgba{((color >> 16) & 0xff) / 255.0, ((color >> 8) & 0xff) / 255.0, (color & 0xff) / 255.0, 1};
    webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(view), &rgba);
}

// The window in front, which a launch's token lets take the front from another app.
void showWindow(const std::string &token) {
    onMainThread([token] {
        const std::optional<crossbind::Window> front = crossbind::windowOf(crossbind::app::frontWindow());
        if (!front) return;
        GtkWindow *window = GTK_WINDOW(front->native());
        if (!token.empty()) gtk_window_set_startup_id(window, token.c_str());
        gtk_window_present(window);
    });
}

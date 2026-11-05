// The page's downloads, which the holder of page-downloads answers (<crossbind/extension.h>).
#include "crossbind/extension.h"
#include "page_requests.h"

#include <cstdio>
#include <filesystem>
#include <stdexcept>

namespace crossbind {

namespace {

constexpr std::chrono::milliseconds PROGRESS_INTERVAL{100};

template <typename Fn, typename... Args>
void tell(const char *what, const std::string &url, const Fn &fn, Args &&...args) {
    try {
        fn(std::forward<Args>(args)...);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the %s of %s: %s\n", app::holderOf("page-downloads").c_str(), what, url.c_str(), error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on the %s of %s\n", app::holderOf("page-downloads").c_str(), what, url.c_str());
    }
}

}  // namespace

const std::string &Download::url() const { return state_->url; }

const std::string &Download::suggestedName() const { return state_->suggestedName; }

const std::string &Download::mimeType() const { return state_->mimeType; }

int64_t Download::size() const { return state_->size; }

Page Download::page() const { return state_->page; }

// A folder there stays: the platform's replace would put the file in its place, its files with it.
void Download::saveTo(const std::string &path) const {
    // The host's paths are UTF-8, as the platform's own narrow ones need not be.
    const std::filesystem::path target(std::u8string(path.begin(), path.end()));
    if (!target.is_absolute()) throw std::invalid_argument("crossbind: a download saves to an absolute path, not " + path);
    std::error_code error;
    if (std::filesystem::is_directory(target, error)) throw std::invalid_argument("crossbind: a download saves to a file, and a folder is at " + path);
    state_->answer.give(app::DownloadAnswer{app::DownloadAnswer::Kind::saveTo, path});
}

void Download::ask() const { state_->answer.give(app::DownloadAnswer{app::DownloadAnswer::Kind::ask, {}}); }

void Download::useDefault() const { ask(); }

void Download::cancel() const {
    if (state_->answer.give(app::DownloadAnswer{})) return;
    std::function<void()> stop;
    {
        std::lock_guard<std::mutex> lock(state_->events->mutex);
        state_->events->isStopped = true;
        stop = state_->events->stop;
    }
    if (stop) stop();
}

// One set once the download has ended would be kept for nothing.
void Download::onProgress(std::function<void(int64_t, int64_t)> fn) const {
    std::lock_guard<std::mutex> lock(state_->events->mutex);
    if (!state_->events->isFinished) state_->events->progress = std::move(fn);
}

void Download::onFinish(std::function<void(const DownloadEnd &)> fn) const {
    std::lock_guard<std::mutex> lock(state_->events->mutex);
    if (!state_->events->isFinished) state_->events->finish = std::move(fn);
}

namespace app {

std::string fileNameOf(const std::string &name) {
    const std::string last = name.substr(name.find_last_of("/\\") + 1);
    return last.empty() || last == "." || last == ".." ? "download" : last;
}

void askDownload(std::shared_ptr<StateOf<Download>> download) {
    const auto &owner = downloadOwner();
    if (!owner) {
        download->answer.give(DownloadAnswer{DownloadAnswer::Kind::ask, {}});
        return;
    }
    try {
        owner(make<Download>(download));
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the extension %s failed on %s: %s\n", holderOf("page-downloads").c_str(), download->url.c_str(), error.what());
        download->answer.give(DownloadAnswer{});
    } catch (...) {
        std::fprintf(stderr, "crossbind: the extension %s failed on %s\n", holderOf("page-downloads").c_str(), download->url.c_str());
        download->answer.give(DownloadAnswer{});
    }
}

bool startDownload(DownloadEvents &events, std::function<void()> stop) {
    std::lock_guard<std::mutex> lock(events.mutex);
    if (events.isStopped) return false;
    events.stop = std::move(stop);
    return true;
}

void tellProgress(DownloadEvents &events, const std::string &url, int64_t received, int64_t size) {
    std::function<void(int64_t, int64_t)> progress;
    {
        std::lock_guard<std::mutex> lock(events.mutex);
        const auto now = std::chrono::steady_clock::now();
        const bool isWhole = size >= 0 && received >= size;
        if (events.isFinished || !events.progress || (!isWhole && now - events.told < PROGRESS_INTERVAL)) return;
        events.told = now;
        progress = events.progress;
    }
    tell("progress", url, progress, received, size);
}

void tellFinish(DownloadEvents &events, const std::string &url, DownloadEnd end) {
    std::function<void(const DownloadEnd &)> finish;
    {
        std::lock_guard<std::mutex> lock(events.mutex);
        if (events.isFinished) return;
        events.isFinished = true;
        finish = std::move(events.finish);
        events.progress = nullptr;
        events.stop = nullptr;
    }
    if (finish) tell("end", url, finish, end);
}

}  // namespace app

}  // namespace crossbind

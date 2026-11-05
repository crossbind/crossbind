#include "main_thread.h"
#include "page_requests.h"
#include "platform.h"

#include <glib/gstdio.h>
#include <webkit2/webkit2.h>

#include <cerrno>
#include <cstdio>
#include <cstring>

using crossbind::Download;
using crossbind::DownloadEnd;
namespace app = crossbind::app;

// page-downloads answers each download the page starts before any of it arrives, as WebKitGTK waits for the
// destination the host sets. What ask() saves goes to the user's Downloads folder by its name, as WebKitGTK puts it
// without the host.
namespace {

constexpr const char *RUNNING = "crossbind-download";

// A download as it runs: what its owner hears, how it failed, and where saveTo() saves it, with the file it arrives in
// beside that till it is whole.
struct Running {
    std::shared_ptr<app::DownloadEvents> events;
    std::string url;
    std::optional<DownloadEnd> failure;
    std::string target;
    std::string arrival;
};

std::string uriOf(const std::string &path) {
    gchar *uri = g_filename_to_uri(path.c_str(), nullptr, nullptr);
    std::string text = uri ? uri : "";
    g_free(uri);
    return text;
}

std::string pathOf(const char *uri) {
    gchar *path = uri ? g_filename_from_uri(uri, nullptr, nullptr) : nullptr;
    std::string text = path ? path : "";
    g_free(path);
    return text;
}

int64_t sizeOf(WebKitDownload *download) {
    WebKitURIResponse *response = webkit_download_get_response(download);
    const guint64 length = response ? webkit_uri_response_get_content_length(response) : 0;
    return length == 0 ? -1 : static_cast<int64_t>(length);
}

void onReceivedData(WebKitDownload *download, guint64, gpointer data) {
    auto *running = static_cast<Running *>(data);
    app::tellProgress(*running->events, running->url, static_cast<int64_t>(webkit_download_get_received_data_length(download)), sizeOf(download));
}

void onFailed(WebKitDownload *, GError *error, gpointer data) {
    auto *running = static_cast<Running *>(data);
    running->failure = g_error_matches(error, WEBKIT_DOWNLOAD_ERROR, WEBKIT_DOWNLOAD_ERROR_CANCELLED_BY_USER)
                           ? DownloadEnd{"", true}
                           : DownloadEnd{"", false, std::string(error ? error->message : "the download failed")};
}

// WebKitGTK emits finished after failed as well.
void onFinished(WebKitDownload *download, gpointer data) {
    auto *running = static_cast<Running *>(data);
    if (running->failure) {
        if (!running->arrival.empty()) g_remove(running->arrival.c_str());
        app::tellFinish(*running->events, running->url, *running->failure);
    } else if (running->target.empty()) {
        app::tellFinish(*running->events, running->url, DownloadEnd{pathOf(webkit_download_get_destination(download))});
    } else if (std::rename(running->arrival.c_str(), running->target.c_str()) != 0) {
        const std::string failure = std::strerror(errno);
        g_remove(running->arrival.c_str());
        app::tellFinish(*running->events, running->url, DownloadEnd{"", false, failure});
    } else {
        app::tellFinish(*running->events, running->url, DownloadEnd{running->target});
    }
}

void answer(WebKitDownload *download, const std::string &name, const app::DownloadAnswer &answer) {
    auto *running = static_cast<Running *>(g_object_get_data(G_OBJECT(download), RUNNING));
    // The download may be gone by the time a cancel() after the answer stops it.
    auto weak = std::shared_ptr<GWeakRef>(new GWeakRef, [](GWeakRef *ref) {
        g_weak_ref_clear(ref);
        delete ref;
    });
    g_weak_ref_init(weak.get(), download);
    const bool isStarted = answer.kind != app::DownloadAnswer::Kind::cancel && app::startDownload(*running->events, [weak] {
        onMainThread([weak] {
            gpointer held = g_weak_ref_get(weak.get());
            if (!held) return;
            webkit_download_cancel(WEBKIT_DOWNLOAD(held));
            g_object_unref(held);
        });
    });
    if (!isStarted) {
        webkit_download_cancel(download);
    } else if (answer.kind == app::DownloadAnswer::Kind::saveTo) {
        gchar *folder = g_path_get_dirname(answer.path.c_str());
        gchar *base = g_path_get_basename(answer.path.c_str());
        gchar *unique = g_uuid_string_random();
        running->target = answer.path;
        running->arrival = std::string(folder) + "/." + base + "." + unique + ".download";
        g_free(unique);
        g_free(base);
        g_free(folder);
        webkit_download_set_destination(download, uriOf(running->arrival).c_str());
    } else {
        const char *folder = g_get_user_special_dir(G_USER_DIRECTORY_DOWNLOAD);
        gchar *path = g_build_filename(folder ? folder : g_get_home_dir(), name.c_str(), nullptr);
        webkit_download_set_destination(download, uriOf(path).c_str());
        g_free(path);
    }
}

// The answer may come later, which WebKitGTK waits for as the handler returns TRUE.
gboolean onDecideDestination(WebKitDownload *download, gchar *suggested, gpointer) {
    auto *running = new Running{std::make_shared<app::DownloadEvents>(), "", std::nullopt, "", ""};
    WebKitURIResponse *response = webkit_download_get_response(download);
    const char *uri = response ? webkit_uri_response_get_uri(response) : nullptr;
    if (!uri) uri = webkit_uri_request_get_uri(webkit_download_get_request(download));
    running->url = uri ? uri : "";
    g_object_set_data_full(G_OBJECT(download), RUNNING, running, [](gpointer data) { delete static_cast<Running *>(data); });
    g_signal_connect(download, "received-data", G_CALLBACK(onReceivedData), running);
    g_signal_connect(download, "failed", G_CALLBACK(onFailed), running);
    g_signal_connect(download, "finished", G_CALLBACK(onFinished), running);
    const std::string name = app::fileNameOf(suggested ? suggested : "");
    const char *mime = response ? webkit_uri_response_get_mime_type(response) : nullptr;
    g_object_ref(download);
    app::askDownload(std::make_shared<app::StateOf<Download>>(running->url, name, mime ? mime : "", sizeOf(download), running->events,
        [download, name](app::DownloadAnswer given) {
            onMainThread([download, name, given] {
                answer(download, name, given);
                g_object_unref(download);
            });
        }));
    return TRUE;
}

void onDownloadStarted(WebKitWebContext *, WebKitDownload *download, gpointer) {
    g_signal_connect(download, "decide-destination", G_CALLBACK(onDecideDestination), nullptr);
}

}  // namespace

void takeDownloads(void *webView) {
    g_signal_connect(webkit_web_view_get_context(WEBKIT_WEB_VIEW(webView)), "download-started", G_CALLBACK(onDownloadStarted), nullptr);
}

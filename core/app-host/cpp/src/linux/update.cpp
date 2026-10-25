#include "platform.h"

#include <libsoup/soup.h>

#include <stdexcept>
#include <vector>

namespace {

constexpr gsize READ_CHUNK = 64 * 1024;
// Seconds a connection may stay silent.
constexpr guint IDLE_TIMEOUT = 60;

}  // namespace

// Linux signs no apps, so an update is the app's when app.updater's key signed it.
void checkSigner(const std::filesystem::path &) {}

// libsoup, which WebKitGTK loads anyway. Its blocking calls run off the main thread in a context of their own, and
// without the decoder that would unpack a .tar.gz a server labels gzip-encoded.
void download(const std::string &url, const std::filesystem::path &file, std::uintmax_t maxBytes) {
    GMainContext *context = g_main_context_new();
    g_main_context_push_thread_default(context);
    SoupSession *session = soup_session_new();
    soup_session_set_timeout(session, IDLE_TIMEOUT);
    soup_session_remove_feature_by_type(session, SOUP_TYPE_CONTENT_DECODER);
    SoupMessage *message = soup_message_new(SOUP_METHOD_GET, url.c_str());
    GError *error = nullptr;
    GInputStream *body = message ? soup_session_send(session, message, nullptr, &error) : nullptr;
    std::string failure;
    if (!message) {
        failure = "crossbind: " + url + " is no address";
    } else if (!body) {
        failure = "crossbind: cannot download " + url + ": " + (error ? error->message : "no reason given");
    } else if (const unsigned status = soup_message_get_status(message); status != SOUP_STATUS_OK) {
        failure = "crossbind: " + url + " answered " + std::to_string(status);
    } else {
        GFile *target = g_file_new_for_path(file.c_str());
        GFileOutputStream *out = g_file_replace(target, nullptr, FALSE, G_FILE_CREATE_NONE, nullptr, &error);
        std::vector<char> chunk(READ_CHUNK);
        std::uintmax_t total = 0;
        gssize read = out ? 0 : -1;
        while (out && (read = g_input_stream_read(body, chunk.data(), chunk.size(), nullptr, &error)) > 0) {
            total += static_cast<std::uintmax_t>(read);
            if (total > maxBytes) break;
            if (!g_output_stream_write_all(G_OUTPUT_STREAM(out), chunk.data(), static_cast<gsize>(read), nullptr, nullptr, &error)) {
                read = -1;
                break;
            }
        }
        if (total > maxBytes) {
            failure = "crossbind: " + url + " answered more than " + std::to_string(maxBytes) + " bytes";
        } else if (read < 0 || !g_output_stream_close(G_OUTPUT_STREAM(out), nullptr, &error)) {
            failure = "crossbind: cannot keep the download of " + url + ": " + (error ? error->message : "no reason given");
        }
        if (out) g_object_unref(out);
        g_object_unref(target);
    }
    g_clear_error(&error);
    if (body) g_object_unref(body);
    if (message) g_object_unref(message);
    g_object_unref(session);
    g_main_context_pop_thread_default(context);
    g_main_context_unref(context);
    if (!failure.empty()) throw std::runtime_error(failure);
}

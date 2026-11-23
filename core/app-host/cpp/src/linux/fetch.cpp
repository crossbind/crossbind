// The fetch() of Linux: libsoup 3, which WebKitGTK links, on the main thread's loop, in a session of its own without a
// cookie jar, a cache or a content decoder, which follows a redirect within the URL's origin itself.
#include "host_core.h"

#include <libsoup/soup.h>

#include <algorithm>
#include <cctype>

namespace app = crossbind::app;

namespace {

constexpr gsize CHUNK_BYTES = 1 << 16;
// libsoup's flags for an http URI, which C++ takes as an int.
const GUriFlags URI_FLAGS = static_cast<GUriFlags>(SOUP_HTTP_URI_FLAGS);

struct Fetch {
    std::string method;
    crossbind::Request::Headers headers;
    std::string body;
    app::FetchDone done;
    SoupSession *session = nullptr;
    SoupMessage *message = nullptr;
    GCancellable *cancellable = nullptr;
    GInputStream *stream = nullptr;
    // The URL asked for first, whose origin a redirect keeps to, and the one asked for now.
    GUri *first = nullptr;
    GUri *current = nullptr;
    guint timer = 0;
    int redirects = 0;
    std::optional<std::string> failure;
    crossbind::FetchResponse response;
};

std::string lower(std::string name) {
    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return name;
}

int portOf(GUri *uri) {
    const int port = g_uri_get_port(uri);
    if (port > 0) return port;
    return g_ascii_strcasecmp(g_uri_get_scheme(uri), "https") == 0 ? 443 : 80;
}

bool isSameOrigin(GUri *from, GUri *to) {
    return g_ascii_strcasecmp(g_uri_get_scheme(from), g_uri_get_scheme(to)) == 0 && g_ascii_strcasecmp(g_uri_get_host(from), g_uri_get_host(to)) == 0
           && portOf(from) == portOf(to);
}

void finish(Fetch *fetch, std::optional<std::string> failure) {
    if (fetch->timer) g_source_remove(fetch->timer);
    if (fetch->stream) g_object_unref(fetch->stream);
    if (fetch->message) g_object_unref(fetch->message);
    g_object_unref(fetch->cancellable);
    g_object_unref(fetch->session);
    g_uri_unref(fetch->first);
    g_uri_unref(fetch->current);
    const app::FetchDone done = std::move(fetch->done);
    crossbind::FetchResponse response = std::move(fetch->response);
    // What the fetch found itself, as its time running out, says why the client stopped.
    if (fetch->failure) failure = fetch->failure;
    delete fetch;
    if (failure) done(failure, {});
    else done(std::nullopt, std::move(response));
}

void finishWith(Fetch *fetch, GError *error) {
    const std::string reason = error->message;
    g_error_free(error);
    finish(fetch, reason);
}

void ask(Fetch *fetch);

void onRead(GObject *stream, GAsyncResult *result, gpointer data) {
    auto *fetch = static_cast<Fetch *>(data);
    GError *error = nullptr;
    GBytes *bytes = g_input_stream_read_bytes_finish(G_INPUT_STREAM(stream), result, &error);
    if (!bytes) {
        finishWith(fetch, error);
        return;
    }
    gsize size = 0;
    const auto *chunk = static_cast<const char *>(g_bytes_get_data(bytes, &size));
    if (size == 0) {
        g_bytes_unref(bytes);
        finish(fetch, std::nullopt);
        return;
    }
    if (fetch->response.body.size() + size > app::MAX_FETCH_BYTES) {
        g_bytes_unref(bytes);
        finish(fetch, app::passedTheLimit());
        return;
    }
    fetch->response.body.append(chunk, size);
    g_bytes_unref(bytes);
    g_input_stream_read_bytes_async(fetch->stream, CHUNK_BYTES, G_PRIORITY_DEFAULT, fetch->cancellable, onRead, fetch);
}

void onSent(GObject *session, GAsyncResult *result, gpointer data) {
    auto *fetch = static_cast<Fetch *>(data);
    GError *error = nullptr;
    fetch->stream = soup_session_send_finish(SOUP_SESSION(session), result, &error);
    if (!fetch->stream) {
        finishWith(fetch, error);
        return;
    }
    const guint status = soup_message_get_status(fetch->message);
    SoupMessageHeaders *headers = soup_message_get_response_headers(fetch->message);
    const char *location = SOUP_STATUS_IS_REDIRECTION(status) ? soup_message_headers_get_one(headers, "Location") : nullptr;
    GUri *next = location ? g_uri_parse_relative(fetch->current, location, URI_FLAGS, nullptr) : nullptr;
    if (next && app::followsRedirects(fetch->method) && isSameOrigin(fetch->first, next)) {
        fetch->redirects += 1;
        if (fetch->redirects > app::MAX_FETCH_REDIRECTS) {
            g_uri_unref(next);
            finish(fetch, app::redirectedTooOften());
            return;
        }
        g_uri_unref(fetch->current);
        fetch->current = next;
        g_object_unref(fetch->stream);
        fetch->stream = nullptr;
        g_object_unref(fetch->message);
        fetch->message = nullptr;
        ask(fetch);
        return;
    }
    if (next) g_uri_unref(next);
    if (soup_message_headers_get_encoding(headers) == SOUP_ENCODING_CONTENT_LENGTH) {
        const goffset declared = soup_message_headers_get_content_length(headers);
        if (declared > static_cast<goffset>(app::MAX_FETCH_BYTES)) {
            finish(fetch, app::declaredTooLarge(static_cast<std::uint64_t>(declared)));
            return;
        }
    }
    fetch->response.status = static_cast<int>(status);
    soup_message_headers_foreach(
        headers,
        [](const char *name, const char *value, gpointer into) {
            static_cast<crossbind::Request::Headers *>(into)->emplace_back(lower(name), value);
        },
        &fetch->response.headers);
    g_input_stream_read_bytes_async(fetch->stream, CHUNK_BYTES, G_PRIORITY_DEFAULT, fetch->cancellable, onRead, fetch);
}

void ask(Fetch *fetch) {
    fetch->message = soup_message_new_from_uri(fetch->method.c_str(), fetch->current);
    soup_message_add_flags(fetch->message, SOUP_MESSAGE_NO_REDIRECT);
    SoupMessageHeaders *headers = soup_message_get_request_headers(fetch->message);
    for (const auto &[name, value] : fetch->headers) soup_message_headers_replace(headers, name.c_str(), value.c_str());
    soup_message_headers_replace(headers, "Accept-Encoding", "identity");
    if (!fetch->body.empty()) {
        // No type of libsoup's: the one the headers give stays.
        GBytes *body = g_bytes_new(fetch->body.data(), fetch->body.size());
        soup_message_set_request_body_from_bytes(fetch->message, nullptr, body);
        g_bytes_unref(body);
    }
    soup_session_send_async(fetch->session, fetch->message, G_PRIORITY_DEFAULT, fetch->cancellable, onSent, fetch);
}

}  // namespace

void crossbind::app::fetchOnPlatform(const std::string &method, const std::string &url, const crossbind::Request::Headers &headers, std::string body,
    FetchDone done) {
    onMainThread([method, url, headers, body = std::move(body), done = std::move(done)]() mutable {
        GError *error = nullptr;
        GUri *uri = g_uri_parse(url.c_str(), URI_FLAGS, &error);
        if (!uri) {
            const std::string reason = error->message;
            g_error_free(error);
            done("crossbind: fetch() cannot read the URL " + url + ": " + reason, {});
            return;
        }
        auto *fetch = new Fetch{method, headers, std::move(body), std::move(done)};
        fetch->session = soup_session_new();
        soup_session_remove_feature_by_type(fetch->session, SOUP_TYPE_CONTENT_DECODER);
        soup_session_set_timeout(fetch->session, FETCH_SECONDS);
        fetch->cancellable = g_cancellable_new();
        fetch->first = uri;
        fetch->current = g_uri_ref(uri);
        fetch->timer = g_timeout_add_seconds(
            FETCH_SECONDS,
            [](gpointer data) {
                auto *timedOut = static_cast<Fetch *>(data);
                timedOut->timer = 0;
                timedOut->failure = tookTooLong();
                g_cancellable_cancel(timedOut->cancellable);
                return G_SOURCE_REMOVE;
            },
            fetch);
        ask(fetch);
    });
}

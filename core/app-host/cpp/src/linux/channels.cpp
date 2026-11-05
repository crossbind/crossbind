#include "main_thread.h"
#include "platform.h"

#include <webkit2/webkit2.h>

#include <cstdio>
#include <cstring>

namespace {

// Wraps the page's console and reports uncaught errors, in the top frame alone.
constexpr const char *CONSOLE_SCRIPT = "(() => {"
    "const text = (args) => args.map((arg) => {"
    "  if (arg instanceof Error) return `${arg.message}\\n${arg.stack}`;"
    "  if (typeof arg === 'string') return arg;"
    "  try { return JSON.stringify(arg); } catch { return String(arg); }"
    "}).join(' ');"
    "const post = (level, args) => window.webkit.messageHandlers.crossbind_console.postMessage([level, text(args)]);"
    "for (const level of ['log', 'info', 'warn', 'error', 'debug']) {"
    "  const original = console[level].bind(console);"
    "  console[level] = (...args) => { post(level, args); original(...args); };"
    "}"
    "addEventListener('error', (event) => post('error', [event.error ?? event.message]));"
    "addEventListener('unhandledrejection', (event) => post('error', [event.reason]));"
    "})();";

std::string stringOf(JSCValue *value) {
    gchar *text = jsc_value_to_string(value);
    std::string result(text ? text : "");
    g_free(text);
    return result;
}

// WebKitGTK does not say which frame sent a message; the host checks the token the message carries instead.
gboolean onMessage(WebKitUserContentManager *, JSCValue *value, WebKitScriptMessageReply *reply, gpointer data) {
    const std::string message = jsc_value_is_string(value) ? stringOf(value) : "";
    JSCContext *context = JSC_CONTEXT(g_object_ref(jsc_value_get_context(value)));
    webkit_script_message_reply_ref(reply);
    (*static_cast<MessageHandler *>(data))("", message, [reply, context](const std::string &text) {
        onMainThread([reply, context, text] {
            JSCValue *answer = jsc_value_new_string(context, text.c_str());
            webkit_script_message_reply_return_value(reply, answer);
            g_object_unref(answer);
            webkit_script_message_reply_unref(reply);
            g_object_unref(context);
        });
    });
    return TRUE;
}

void onConsole(WebKitUserContentManager *, WebKitJavascriptResult *result, gpointer) {
    JSCValue *entry = webkit_javascript_result_get_js_value(result);
    JSCValue *level = jsc_value_object_get_property_at_index(entry, 0);
    JSCValue *text = jsc_value_object_get_property_at_index(entry, 1);
    const std::string name = stringOf(level);
    std::FILE *out = name == "warn" || name == "error" ? stderr : stdout;
    std::fprintf(out, "%s\n", stringOf(text).c_str());
    std::fflush(out);
    g_object_unref(level);
    g_object_unref(text);
}

std::vector<uint8_t> readBody(WebKitURISchemeRequest *request) {
    std::vector<uint8_t> body;
    GInputStream *stream = webkit_uri_scheme_request_get_http_body(request);
    if (!stream) return body;
    uint8_t chunk[65536];
    for (gssize read; (read = g_input_stream_read(stream, chunk, sizeof chunk, nullptr, nullptr)) > 0;) {
        body.insert(body.end(), chunk, chunk + read);
    }
    g_object_unref(stream);
    return body;
}

void respond(WebKitURISchemeRequest *request, SchemeResponse response) {
    GInputStream *stream = nullptr;
    gint64 length = 0;
    if (response.file.empty()) {
        auto *bytes = new std::vector<uint8_t>(std::move(response.body));
        GBytes *data = g_bytes_new_with_free_func(bytes->data(), bytes->size(),
            [](gpointer owned) { delete static_cast<std::vector<uint8_t> *>(owned); }, bytes);
        stream = g_memory_input_stream_new_from_bytes(data);
        length = static_cast<gint64>(g_bytes_get_size(data));
        g_bytes_unref(data);
    } else {
        // WebKit reads a file's stream as the page takes it.
        GFile *file = g_file_new_for_path(response.file.c_str());
        GError *error = nullptr;
        GFileInputStream *read = g_file_read(file, nullptr, &error);
        g_object_unref(file);
        if (!read) {
            webkit_uri_scheme_request_finish_error(request, error);
            g_error_free(error);
            g_object_unref(request);
            return;
        }
        stream = G_INPUT_STREAM(read);
        length = static_cast<gint64>(response.fileLength);
    }
    WebKitURISchemeResponse *answer = webkit_uri_scheme_response_new(stream, length);
    webkit_uri_scheme_response_set_status(answer, static_cast<guint>(response.status), nullptr);
    webkit_uri_scheme_response_set_content_type(answer, response.mime.c_str());
    if (!response.headers.empty()) {
        SoupMessageHeaders *headers = soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE);
        for (const auto &[name, value] : response.headers) soup_message_headers_append(headers, name.c_str(), value.c_str());
        webkit_uri_scheme_response_set_http_headers(answer, headers);
    }
    webkit_uri_scheme_request_finish_with_response(request, answer);
    g_object_unref(answer);
    g_object_unref(stream);
    g_object_unref(request);
}

void onSchemeRequest(WebKitURISchemeRequest *request, gpointer data) {
    SchemeRequest incoming;
    const char *method = webkit_uri_scheme_request_get_http_method(request);
    incoming.method = method ? method : "GET";
    const char *path = webkit_uri_scheme_request_get_path(request);
    incoming.path = path ? path : "";
    const char *uri = webkit_uri_scheme_request_get_uri(request);
    const char *query = uri ? std::strchr(uri, '?') : nullptr;
    incoming.query = query ? query + 1 : "";
    incoming.body = readBody(request);
    if (SoupMessageHeaders *headers = webkit_uri_scheme_request_get_http_headers(request)) {
        soup_message_headers_foreach(
            headers,
            [](const char *name, const char *value, gpointer into) {
                static_cast<std::vector<std::pair<std::string, std::string>> *>(into)->emplace_back(name, value);
            },
            &incoming.headers);
    }
    g_object_ref(request);
    (*static_cast<SchemeHandler *>(data))(std::move(incoming), [request](SchemeResponse response) {
        onMainThread([request, response = std::move(response)]() mutable { respond(request, std::move(response)); });
    });
}

}  // namespace

void installReplyChannel(void *webView, const char *name, MessageHandler handler) {
    WebKitUserContentManager *manager = webkit_web_view_get_user_content_manager(WEBKIT_WEB_VIEW(webView));
    const std::string signal = std::string("script-message-with-reply-received::") + name;
    g_signal_connect(manager, signal.c_str(), G_CALLBACK(onMessage), new MessageHandler(std::move(handler)));
    webkit_user_content_manager_register_script_message_handler_with_reply(manager, name, nullptr);
}

void forwardConsole(void *webView) {
    WebKitUserContentManager *manager = webkit_web_view_get_user_content_manager(WEBKIT_WEB_VIEW(webView));
    g_signal_connect(manager, "script-message-received::crossbind_console", G_CALLBACK(onConsole), nullptr);
    webkit_user_content_manager_register_script_message_handler(manager, "crossbind_console");
    addTopFrameScript(webView, CONSOLE_SCRIPT);
}

void addTopFrameScript(void *webView, const std::string &source) {
    WebKitUserContentManager *manager = webkit_web_view_get_user_content_manager(WEBKIT_WEB_VIEW(webView));
    WebKitUserScript *script = webkit_user_script_new(source.c_str(), WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, nullptr, nullptr);
    webkit_user_content_manager_add_script(manager, script);
    webkit_user_script_unref(script);
}

// The page's requests are secure-context requests, and CORS applies to them as it does to https.
void registerSchemeHandler(void *target, const char *scheme, SchemeHandler handler) {
    WebKitWebContext *context = webkit_web_view_get_context(WEBKIT_WEB_VIEW(target));
    webkit_web_context_register_uri_scheme(context, scheme, onSchemeRequest, new SchemeHandler(std::move(handler)),
        [](gpointer owned) { delete static_cast<SchemeHandler *>(owned); });
    WebKitSecurityManager *security = webkit_web_context_get_security_manager(context);
    webkit_security_manager_register_uri_scheme_as_secure(security, scheme);
    webkit_security_manager_register_uri_scheme_as_cors_enabled(security, scheme);
}

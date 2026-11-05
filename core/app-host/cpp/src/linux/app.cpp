#include "app.h"
#include "crossbind_app.h"
#include "host_core.h"
#include "page_requests.h"
#include "platform.h"

#include <gtk/gtk.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <climits>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace {

std::string executablePath() {
    char path[PATH_MAX];
    const ssize_t length = readlink("/proc/self/exe", path, sizeof path);
    return length > 0 ? std::string(path, static_cast<size_t>(length)) : std::string();
}

}  // namespace

// A Linux app is a directory: the executable, and the app's files in resources/ beside it.
std::string resourceDir() {
    const std::string executable = executablePath();
    return executable.substr(0, executable.find_last_of('/')) + "/resources";
}

// The app ends with its window; anything else ends the process as it ends any other.
void onQuit(std::function<void()>) {}

namespace {

using crossbind::FileInput;
using crossbind::PageDialog;

// The page waits for a dialog's answer, which the extension that takes them gives, WebKitGTK's own then closing. A page
// that leaves does so without asking, as WKWebView's does.
gboolean onScriptDialog(WebKitWebView *, WebKitScriptDialog *dialog, gpointer) {
    const WebKitScriptDialogType type = webkit_script_dialog_get_dialog_type(dialog);
    if (type == WEBKIT_SCRIPT_DIALOG_BEFORE_UNLOAD_CONFIRM) {
        webkit_script_dialog_confirm_set_confirmed(dialog, TRUE);
        return TRUE;
    }
    const PageDialog::Kind kind = type == WEBKIT_SCRIPT_DIALOG_ALERT     ? PageDialog::Kind::alert
                                  : type == WEBKIT_SCRIPT_DIALOG_CONFIRM ? PageDialog::Kind::confirm
                                                                         : PageDialog::Kind::prompt;
    const char *text = kind == PageDialog::Kind::prompt ? webkit_script_dialog_prompt_get_default_text(dialog) : nullptr;
    webkit_script_dialog_ref(dialog);
    crossbind::app::askPageDialog(PageDialog(std::make_shared<PageDialog::State>(
        kind, webkit_script_dialog_get_message(dialog), text ? text : "", [dialog, kind](std::optional<std::string> answer) {
            if (kind == PageDialog::Kind::confirm) webkit_script_dialog_confirm_set_confirmed(dialog, answer.has_value());
            // A prompt without a text answers null.
            if (kind == PageDialog::Kind::prompt && answer) webkit_script_dialog_prompt_set_text(dialog, answer->c_str());
            webkit_script_dialog_close(dialog);
            webkit_script_dialog_unref(dialog);
        })));
    return TRUE;
}

gboolean onFileChooser(WebKitWebView *, WebKitFileChooserRequest *request, gpointer) {
    std::vector<std::string> accept;
    if (const gchar *const *types = webkit_file_chooser_request_get_mime_types(request)) {
        for (; *types; ++types) accept.emplace_back(*types);
    }
    g_object_ref(request);
    crossbind::app::askFileInput(FileInput(std::make_shared<FileInput::State>(
        webkit_file_chooser_request_get_select_multiple(request), false, std::move(accept), [request](std::optional<std::vector<std::string>> paths) {
            if (paths) {
                std::vector<const gchar *> files;
                for (const auto &path : *paths) files.push_back(path.c_str());
                files.push_back(nullptr);
                webkit_file_chooser_request_select_files(request, files.data());
            } else {
                webkit_file_chooser_request_cancel(request);
            }
            g_object_unref(request);
        })));
    return TRUE;
}

// What the page asks to use, by the names page-permissions takes. A request goes by its type's name where WebKitGTK
// has it past 2.40 alone, so that the app links to no symbol of a later one.
std::vector<std::string> kindsOf(WebKitPermissionRequest *request) {
    if (WEBKIT_IS_USER_MEDIA_PERMISSION_REQUEST(request)) {
        auto *media = WEBKIT_USER_MEDIA_PERMISSION_REQUEST(request);
        if (webkit_user_media_permission_is_for_display_device(media)) return {"screen"};
        std::vector<std::string> kinds;
        if (webkit_user_media_permission_is_for_video_device(media)) kinds.emplace_back("camera");
        if (webkit_user_media_permission_is_for_audio_device(media)) kinds.emplace_back("microphone");
        return kinds;
    }
    if (WEBKIT_IS_GEOLOCATION_PERMISSION_REQUEST(request)) return {"location"};
    static const std::map<std::string, std::string> named = {
        // WebKitGTK asks about a clipboard read on its user's gesture alone.
        {"WebKitClipboardPermissionRequest", "clipboard"},
        {"WebKitNotificationPermissionRequest", "notifications"},
        {"WebKitDeviceInfoPermissionRequest", "device-info"},
        {"WebKitMediaKeySystemPermissionRequest", "media-keys"},
        {"WebKitPointerLockPermissionRequest", "pointer-lock"},
        {"WebKitWebsiteDataAccessPermissionRequest", "website-data"},
        {"WebKitInstallMissingMediaPluginsPermissionRequest", "media-plugins"},
    };
    const auto kind = named.find(G_OBJECT_TYPE_NAME(request));
    return {kind == named.end() ? "unknown" : kind->second};
}

gboolean onPermissionRequest(WebKitWebView *webView, WebKitPermissionRequest *request, gpointer) {
    g_object_ref(request);
    const char *uri = webkit_web_view_get_uri(webView);
    crossbind::app::askPagePermission(crossbind::app::pagePermission(kindsOf(request), crossbind::app::originOf(uri ? uri : ""), [request](bool isAllowed) {
        if (isAllowed) webkit_permission_request_allow(request);
        else webkit_permission_request_deny(request);
        g_object_unref(request);
    }));
    return TRUE;
}

}  // namespace

// The page's dialogs and file inputs go to the extensions that take them; without one, WebKitGTK shows its own.
void showPageDialogs(void *webView) {
    if (crossbind::app::hasPageDialogs()) g_signal_connect(webView, "script-dialog", G_CALLBACK(onScriptDialog), nullptr);
    if (crossbind::app::hasFileInputs()) g_signal_connect(webView, "run-file-chooser", G_CALLBACK(onFileChooser), nullptr);
}

// What the page asks to use goes to page-permissions; without it, WebKitGTK denies everything. A page has neither
// camera nor microphone without WebKitGTK's media streams, which are off by default.
void answerPermissions(void *webView) {
    if (CROSSBIND_APP_PERMISSION_CAMERA || CROSSBIND_APP_PERMISSION_MICROPHONE) {
        webkit_settings_set_enable_media_stream(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(webView)), TRUE);
    }
    if (crossbind::app::hasPagePermissions()) g_signal_connect(webView, "permission-request", G_CALLBACK(onPermissionRequest), nullptr);
}

// Without a display GTK cannot show it either, and the output alone tells it.
void showError(const std::string &message) {
    if (!gtk_init_check(nullptr, nullptr)) return;
    GtkWidget *dialog = gtk_message_dialog_new(nullptr, GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE, "%s cannot open",
                                               CROSSBIND_APP_NAME);
    gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s", message.c_str());
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
}

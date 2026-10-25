#include "crossbind_app.h"
#include "host_core.h"
#include "platform.h"

#include <gtk/gtk.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

#include <climits>

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

// logind says the system goes to sleep and wakes over the system bus, which a container may not have. It sleeps without
// waiting for the page.
void listenForSleep() {
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, nullptr);
    if (!bus) return;
    // GDBus ends the app by default when the bus goes away.
    g_dbus_connection_set_exit_on_close(bus, FALSE);
    g_dbus_connection_signal_subscribe(
        bus, "org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
        +[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters, gpointer) {
            gboolean isSleeping = FALSE;
            g_variant_get(parameters, "(b)", &isSleeping);
            crossbind::app::postEvent(isSleeping ? "suspend" : "resume", "null");
        },
        nullptr, nullptr);
}

// WebKitGTK shows the page's dialogs, file inputs and downloads itself.
void showPageDialogs(void *) {}

// The page gets the devices app.permissions lists, and no other, without a question, and reads the clipboard on its
// user's gesture; WebKitGTK decides the rest. A page has neither camera nor microphone without WebKitGTK's media
// streams, which are off by default.
void answerPermissions(void *webView) {
    if (CROSSBIND_APP_PERMISSION_CAMERA || CROSSBIND_APP_PERMISSION_MICROPHONE) {
        webkit_settings_set_enable_media_stream(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(webView)), TRUE);
    }
    g_signal_connect(webView, "permission-request", G_CALLBACK(+[](WebKitWebView *, WebKitPermissionRequest *request, gpointer) -> gboolean {
                         bool isAllowed = false;
                         if (WEBKIT_IS_USER_MEDIA_PERMISSION_REQUEST(request)) {
                             auto *media = WEBKIT_USER_MEDIA_PERMISSION_REQUEST(request);
                             const bool isVideo = webkit_user_media_permission_is_for_video_device(media);
                             const bool isAudio = webkit_user_media_permission_is_for_audio_device(media);
                             isAllowed = (isVideo || isAudio) && !webkit_user_media_permission_is_for_display_device(media) &&
                                         (!isVideo || CROSSBIND_APP_PERMISSION_CAMERA) && (!isAudio || CROSSBIND_APP_PERMISSION_MICROPHONE);
                         } else if (WEBKIT_IS_GEOLOCATION_PERMISSION_REQUEST(request)) {
                             isAllowed = CROSSBIND_APP_PERMISSION_LOCATION;
                         } else if (g_strcmp0(G_OBJECT_TYPE_NAME(request), "WebKitClipboardPermissionRequest") == 0) {
                             // WebKitGTK asks about a read on its user's gesture alone. The request goes by its name, so
                             // that the app links to no symbol of a WebKitGTK past 2.40.
                             isAllowed = true;
                         } else {
                             return FALSE;
                         }
                         if (isAllowed) {
                             webkit_permission_request_allow(request);
                         } else {
                             webkit_permission_request_deny(request);
                         }
                         return TRUE;
                     }),
                     nullptr);
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

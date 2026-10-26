#include "crossbind_app.h"
#include "host_core.h"
#include "linux/main_thread.h"
#include "platform.h"

#include <gio/gio.h>

#include <memory>
#include <optional>
#include <set>
#include <string>

// A notification goes to the desktop's notification server, which tells of a click on it as its default action.
namespace {

constexpr const char *NOTIFICATIONS = "org.freedesktop.Notifications";
constexpr const char *NOTIFICATIONS_PATH = "/org/freedesktop/Notifications";
// The server's own time for a notification to show.
constexpr gint32 SERVER_EXPIRY = -1;

// The notifications the server showed for the app, which another app's clicks are not.
std::set<guint32> shown;
// Whether the server reads markup in a notification's body, which then takes the page's text escaped.
std::optional<bool> isMarkupRead;

void actionInvoked(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters, gpointer) {
    guint32 id = 0;
    const gchar *action = nullptr;
    g_variant_get(parameters, "(u&s)", &id, &action);
    if (shown.count(id) && g_strcmp0(action, "default") == 0) crossbind::app::postEvent("notification", "null");
}

void notificationClosed(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters, gpointer) {
    guint32 id = 0;
    g_variant_get(parameters, "(uu)", &id, nullptr);
    shown.erase(id);
}

// Null without a session bus.
GDBusConnection *sessionBus() {
    static GDBusConnection *bus = [] {
        GDBusConnection *made = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
        if (!made) return made;
        // GDBus ends the app by default when the bus goes away.
        g_dbus_connection_set_exit_on_close(made, FALSE);
        g_dbus_connection_signal_subscribe(made, NOTIFICATIONS, NOTIFICATIONS, "ActionInvoked", NOTIFICATIONS_PATH, nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
                                           actionInvoked, nullptr, nullptr);
        g_dbus_connection_signal_subscribe(made, NOTIFICATIONS, NOTIFICATIONS, "NotificationClosed", NOTIFICATIONS_PATH, nullptr,
                                           G_DBUS_SIGNAL_FLAGS_NONE, notificationClosed, nullptr, nullptr);
        return made;
    }();
    return bus;
}

struct Pending {
    Notification notification;
    std::function<void(Failure)> done;
};

void notified(GObject *source, GAsyncResult *result, gpointer data) {
    const std::unique_ptr<Pending> pending(static_cast<Pending *>(data));
    GError *error = nullptr;
    GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
    if (!reply) {
        const std::string why = std::string("crossbind: the desktop did not show the notification: ") + error->message;
        g_error_free(error);
        pending->done(why);
        return;
    }
    guint32 id = 0;
    g_variant_get(reply, "(u)", &id);
    g_variant_unref(reply);
    shown.insert(id);
    pending->done(std::nullopt);
}

// Its default action is what a click on it does, which most servers show no button for.
void notify(std::unique_ptr<Pending> pending, bool isMarkup) {
    const Notification &notification = pending->notification;
    gchar *body = isMarkup ? g_markup_escape_text(notification.body.c_str(), -1) : g_strdup(notification.body.c_str());
    const std::string file = resourceDir() + "/icon.png";
    gchar *icon = g_file_test(file.c_str(), G_FILE_TEST_EXISTS) ? g_filename_to_uri(file.c_str(), nullptr, nullptr) : nullptr;
    const gchar *actions[] = {"default", "Open", nullptr};
    GVariant *parameters = g_variant_new("(susss^as@a{sv}i)", CROSSBIND_APP_NAME, 0, icon ? icon : "", notification.title.c_str(), body,
                                         actions, g_variant_new_array(G_VARIANT_TYPE("{sv}"), nullptr, 0), SERVER_EXPIRY);
    g_free(icon);
    g_free(body);
    g_dbus_connection_call(sessionBus(), NOTIFICATIONS, NOTIFICATIONS_PATH, NOTIFICATIONS, "Notify", parameters, G_VARIANT_TYPE("(u)"),
                           G_DBUS_CALL_FLAGS_NONE, -1, nullptr, notified, pending.release());
}

// A server without the capability body-markup shows markup as it is, and one with it reads an & as markup's.
void capabilitiesRead(GObject *source, GAsyncResult *result, gpointer data) {
    std::unique_ptr<Pending> pending(static_cast<Pending *>(data));
    GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, nullptr);
    // Notify then tells why the server cannot be reached.
    if (!reply) return notify(std::move(pending), false);
    const gchar **capabilities = nullptr;
    g_variant_get(reply, "(^a&s)", &capabilities);
    bool isMarkup = false;
    for (const gchar **capability = capabilities; capability && *capability; capability += 1) {
        isMarkup = isMarkup || g_strcmp0(*capability, "body-markup") == 0;
    }
    g_free(capabilities);
    g_variant_unref(reply);
    isMarkupRead = isMarkup;
    notify(std::move(pending), isMarkup);
}

}  // namespace

void showNotification(Notification notification, std::function<void(Failure)> done) {
    onMainThread([notification = std::move(notification), done = std::move(done)] {
        GDBusConnection *bus = sessionBus();
        if (!bus) {
            done("crossbind: the app has no session bus to show its notifications on");
            return;
        }
        auto pending = std::make_unique<Pending>(Pending{notification, done});
        if (isMarkupRead) {
            notify(std::move(pending), *isMarkupRead);
            return;
        }
        g_dbus_connection_call(bus, NOTIFICATIONS, NOTIFICATIONS_PATH, NOTIFICATIONS, "GetCapabilities", nullptr, G_VARIANT_TYPE("(as)"),
                               G_DBUS_CALL_FLAGS_NONE, -1, nullptr, capabilitiesRead, pending.release());
    });
}

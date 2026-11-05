#include "power.h"

#include "crossbind/app.h"

#include <gio/gio.h>

// logind says the system goes to sleep and wakes over the system bus, which a container may not have. It sleeps without
// waiting for the page.
void crossbind::power::listen() {
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, nullptr);
    if (!bus) return;
    // GDBus ends the app by default when the bus goes away.
    g_dbus_connection_set_exit_on_close(bus, FALSE);
    g_dbus_connection_signal_subscribe(
        bus, "org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
        +[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters, gpointer) {
            gboolean isSleeping = FALSE;
            g_variant_get(parameters, "(b)", &isSleeping);
            crossbind::app::emitEvent(isSleeping ? "suspend" : "resume");
        },
        nullptr, nullptr);
}

#include "crossbind_app.h"
#include "host_core.h"
#include "linux/main_thread.h"
#include "platform.h"

#include <gtk/gtk.h>

#include <map>
#include <string>
#include <utility>
#include <vector>

// The tray's icon is a StatusNotifierItem, which the trays of KDE, Xfce and others show, and GNOME's with its
// AppIndicator extension, and its menu a com.canonical.dbusmenu, which the tray shows itself.
namespace {

constexpr const char *ITEM_PATH = "/StatusNotifierItem";
constexpr const char *ITEM_INTERFACE = "org.kde.StatusNotifierItem";
constexpr const char *MENU_PATH = "/MenuBar";
constexpr const char *MENU_INTERFACE = "com.canonical.dbusmenu";
// What an item without a menu names as its menu, as Qt's and KDE's trays read it.
constexpr const char *NO_MENU_PATH = "/NO_DBUSMENU";
constexpr const char *WATCHER = "org.kde.StatusNotifierWatcher";
constexpr const char *WATCHER_PATH = "/StatusNotifierWatcher";
constexpr guint32 DBUSMENU_VERSION = 3;
const char *const NO_TRAY = "crossbind: the desktop shows no status tray, which GNOME shows with its AppIndicator extension";

const char *const ITEM_XML = R"xml(<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconThemePath" type="s" access="read"/>
    <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
    <signal name="NewTitle"/>
    <signal name="NewIcon"/>
    <signal name="NewToolTip"/>
    <signal name="NewStatus"><arg type="s"/></signal>
  </interface>
</node>)xml";

const char *const MENU_XML = R"xml(<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="TextDirection" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconThemePath" type="as" access="read"/>
    <method name="GetLayout">
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
      <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="GetGroupProperties">
      <arg type="ai" direction="in"/><arg type="as" direction="in"/><arg type="a(ia{sv})" direction="out"/>
    </method>
    <method name="GetProperty">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/>
    </method>
    <method name="Event">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/>
    </method>
    <method name="EventGroup"><arg type="a(isvu)" direction="in"/><arg type="ai" direction="out"/></method>
    <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="AboutToShowGroup">
      <arg type="ai" direction="in"/><arg type="ai" direction="out"/><arg type="ai" direction="out"/>
    </method>
    <signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
    <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
  </interface>
</node>)xml";

// An item of the tray's menu by its id, which each change of the menu gives anew, so a click on one of the menu before
// finds none; the menu itself is 0.
struct Entry {
    MenuItem item;
    std::vector<gint32> children;
};

std::map<gint32, Entry> entries;
gint32 nextId = 1;
guint32 revision = 0;
std::string tooltip;
MenuClicked onClick;

// The tray's own connection to the session bus: a tray takes the icon away once its owner leaves the bus, as when the
// connection closes.
GDBusConnection *connection = nullptr;
guint itemObject = 0;
guint menuObject = 0;
guint watcherWatch = 0;
bool isWatcherSeen = false;
// Moves on as the connection goes, so the tray's answer for an icon taken away tells nothing.
guint generation = 0;

// The sets of the tray waiting for it to take the icon, which the first of them asked for.
std::vector<std::function<void(Failure)>> waitingSets;

Failure failure(const std::string &what, const GError *error) { return error ? what + ": " + error->message : what; }

gint32 addEntry(const MenuItem &item) {
    const gint32 id = nextId++;
    Entry entry{item, {}};
    entry.item.items.clear();
    for (const auto &child : item.items) entry.children.push_back(addEntry(child));
    entries[id] = std::move(entry);
    return id;
}

void setEntries(const std::vector<MenuItem> &menu) {
    entries.clear();
    MenuItem root;
    root.isSubmenu = true;
    Entry top{root, {}};
    for (const auto &item : menu) top.children.push_back(addEntry(item));
    entries[0] = std::move(top);
    revision += 1;
}

bool hasMenu() { return !entries.at(0).children.empty(); }

// dbusmenu reads an underscore as the start of a key's name.
std::string labelOf(const std::string &label) {
    std::string escaped;
    for (const char c : label) escaped += c == '_' ? std::string("__") : std::string(1, c);
    return escaped;
}

// The properties dbusmenu leaves out are at their defaults: a standard item, enabled and unchecked.
GVariant *propertiesOf(const Entry &entry) {
    GVariantBuilder properties;
    g_variant_builder_init(&properties, G_VARIANT_TYPE_VARDICT);
    const MenuItem &item = entry.item;
    if (item.isSeparator) {
        g_variant_builder_add(&properties, "{sv}", "type", g_variant_new_string("separator"));
        return g_variant_builder_end(&properties);
    }
    if (!item.label.empty()) g_variant_builder_add(&properties, "{sv}", "label", g_variant_new_string(labelOf(item.label).c_str()));
    if (!item.isEnabled) g_variant_builder_add(&properties, "{sv}", "enabled", g_variant_new_boolean(FALSE));
    if (item.checked) {
        g_variant_builder_add(&properties, "{sv}", "toggle-type", g_variant_new_string("checkmark"));
        g_variant_builder_add(&properties, "{sv}", "toggle-state", g_variant_new_int32(*item.checked ? 1 : 0));
    }
    if (item.isSubmenu) g_variant_builder_add(&properties, "{sv}", "children-display", g_variant_new_string("submenu"));
    return g_variant_builder_end(&properties);
}

// A depth of -1 reaches every item below.
GVariant *layoutOf(gint32 id, gint32 depth) {
    const Entry &entry = entries.at(id);
    GVariantBuilder children;
    g_variant_builder_init(&children, G_VARIANT_TYPE("av"));
    if (depth != 0) {
        for (const gint32 child : entry.children) g_variant_builder_add(&children, "v", layoutOf(child, depth - 1));
    }
    return g_variant_new("(i@a{sv}@av)", id, propertiesOf(entry), g_variant_builder_end(&children));
}

// A click toggles an item with checked first, which the tray hears of.
void clicked(gint32 id) {
    const auto found = entries.find(id);
    if (found == entries.end()) return;
    MenuItem &item = found->second.item;
    if (item.isSeparator || item.isSubmenu || !item.isEnabled) return;
    if (item.checked) {
        item.checked = !*item.checked;
        GVariantBuilder updated;
        g_variant_builder_init(&updated, G_VARIANT_TYPE("a(ia{sv})"));
        g_variant_builder_add(&updated, "(i@a{sv})", id, propertiesOf(found->second));
        g_dbus_connection_emit_signal(connection, nullptr, MENU_PATH, MENU_INTERFACE, "ItemsPropertiesUpdated",
                                      g_variant_new("(@a(ia{sv})@a(ias))", g_variant_builder_end(&updated),
                                                    g_variant_new_array(G_VARIANT_TYPE("(ias)"), nullptr, 0)),
                                      nullptr);
    }
    if (onClick && !item.id.empty()) onClick(item.id, item.checked);
}

void returnNoEntry(GDBusMethodInvocation *invocation, gint32 id) {
    g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS, "the tray's menu has no item %d", id);
}

GVariant *noIds() { return g_variant_new_array(G_VARIANT_TYPE_INT32, nullptr, 0); }

// GDBus answers a call of a method the XML has not.
void menuCalled(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method, GVariant *parameters,
                GDBusMethodInvocation *invocation, gpointer) {
    const std::string name = method;
    if (name == "GetLayout") {
        gint32 parent = 0;
        gint32 depth = 0;
        g_variant_get(parameters, "(ii@as)", &parent, &depth, nullptr);
        if (!entries.count(parent)) return returnNoEntry(invocation, parent);
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(u@(ia{sv}av))", revision, layoutOf(parent, depth)));
    } else if (name == "GetGroupProperties") {
        GVariantIter *ids = nullptr;
        g_variant_get(parameters, "(ai@as)", &ids, nullptr);
        GVariantBuilder found;
        g_variant_builder_init(&found, G_VARIANT_TYPE("a(ia{sv})"));
        gint32 id = 0;
        while (g_variant_iter_next(ids, "i", &id)) {
            if (const auto entry = entries.find(id); entry != entries.end()) {
                g_variant_builder_add(&found, "(i@a{sv})", id, propertiesOf(entry->second));
            }
        }
        g_variant_iter_free(ids);
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(@a(ia{sv}))", g_variant_builder_end(&found)));
    } else if (name == "GetProperty") {
        gint32 id = 0;
        const gchar *property = nullptr;
        g_variant_get(parameters, "(i&s)", &id, &property);
        const auto entry = entries.find(id);
        if (entry == entries.end()) return returnNoEntry(invocation, id);
        GVariant *properties = g_variant_ref_sink(propertiesOf(entry->second));
        GVariant *value = g_variant_lookup_value(properties, property, nullptr);
        g_variant_unref(properties);
        if (!value) {
            g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS, "the item has no %s", property);
            return;
        }
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(@v)", g_variant_new_variant(value)));
        g_variant_unref(value);
    } else if (name == "Event") {
        gint32 id = 0;
        const gchar *event = nullptr;
        g_variant_get(parameters, "(i&svu)", &id, &event, nullptr, nullptr);
        if (!entries.count(id)) return returnNoEntry(invocation, id);
        if (g_strcmp0(event, "clicked") == 0) clicked(id);
        g_dbus_method_invocation_return_value(invocation, nullptr);
    } else if (name == "EventGroup") {
        GVariantIter *events = nullptr;
        g_variant_get(parameters, "(a(isvu))", &events);
        GVariantBuilder missing;
        g_variant_builder_init(&missing, G_VARIANT_TYPE("ai"));
        gint32 id = 0;
        const gchar *event = nullptr;
        while (g_variant_iter_next(events, "(i&svu)", &id, &event, nullptr, nullptr)) {
            if (!entries.count(id)) {
                g_variant_builder_add(&missing, "i", id);
            } else if (g_strcmp0(event, "clicked") == 0) {
                clicked(id);
            }
        }
        g_variant_iter_free(events);
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(@ai)", g_variant_builder_end(&missing)));
    } else if (name == "AboutToShow") {
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(b)", FALSE));
    } else if (name == "AboutToShowGroup") {
        g_dbus_method_invocation_return_value(invocation, g_variant_new("(@ai@ai)", noIds(), noIds()));
    }
}

GVariant *menuProperty(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *property, GError **, gpointer) {
    const std::string name = property;
    if (name == "Version") return g_variant_new_uint32(DBUSMENU_VERSION);
    if (name == "TextDirection") return g_variant_new_string(gtk_widget_get_default_direction() == GTK_TEXT_DIR_RTL ? "rtl" : "ltr");
    if (name == "Status") return g_variant_new_string("normal");
    return g_variant_new_strv(nullptr, 0);
}

// The app's icon, which a Linux app's build puts in its files.
bool hasIcon() {
    static const bool has = g_file_test((resourceDir() + "/icon.png").c_str(), G_FILE_TEST_EXISTS);
    return has;
}

GVariant *toolTip() {
    return g_variant_new("(s@a(iiay)ss)", "", g_variant_new_array(G_VARIANT_TYPE("(iiay)"), nullptr, 0), tooltip.c_str(), "");
}

GVariant *menuPath() { return g_variant_new_object_path(hasMenu() ? MENU_PATH : NO_MENU_PATH); }

GVariant *itemProperty(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *property, GError **, gpointer) {
    const std::string name = property;
    if (name == "Category") return g_variant_new_string("ApplicationStatus");
    if (name == "Id") return g_variant_new_string(CROSSBIND_APP_ID);
    if (name == "Title") return g_variant_new_string(CROSSBIND_APP_NAME);
    if (name == "Status") return g_variant_new_string("Active");
    // A tray finds the app's icon by its name in the app's files, as an AppIndicator's, or one of its theme for an app
    // without an icon.
    if (name == "IconName") return g_variant_new_string(hasIcon() ? "icon" : "application-x-executable");
    if (name == "IconThemePath") return g_variant_new_string(hasIcon() ? resourceDir().c_str() : "");
    if (name == "ToolTip") return toolTip();
    if (name == "ItemIsMenu") return g_variant_new_boolean(FALSE);
    return menuPath();
}

// A tray calls ContextMenu on a right click of an item without a menu, which the item would show itself.
void itemCalled(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method, GVariant *,
                GDBusMethodInvocation *invocation, gpointer) {
    const std::string name = method;
    if (name == "Activate" || (name == "ContextMenu" && !hasMenu())) crossbind::app::postEvent("tray", "null");
    g_dbus_method_invocation_return_value(invocation, nullptr);
}

const GDBusInterfaceVTable ITEM_CALLS{itemCalled, itemProperty, nullptr, {}};
const GDBusInterfaceVTable MENU_CALLS{menuCalled, menuProperty, nullptr, {}};

void disconnect() {
    generation += 1;
    if (!connection) return;
    if (watcherWatch) g_bus_unwatch_name(watcherWatch);
    if (menuObject) g_dbus_connection_unregister_object(connection, menuObject);
    if (itemObject) g_dbus_connection_unregister_object(connection, itemObject);
    g_dbus_connection_close(connection, nullptr, nullptr, nullptr);
    g_object_unref(connection);
    connection = nullptr;
    watcherWatch = 0;
    menuObject = 0;
    itemObject = 0;
}

void answerSets(const Failure &failure) {
    for (auto &done : std::exchange(waitingSets, {})) done(failure);
}

bool isMissing(const GError *error) {
    return g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_SERVICE_UNKNOWN) || g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_NAME_HAS_NO_OWNER);
}

// The answer of a call made for an icon the page took away meanwhile tells nothing, as removeTray answered its sets.
bool isCurrent(gpointer generationAsked) { return GPOINTER_TO_UINT(generationAsked) == generation; }

void registered(GObject *source, GAsyncResult *result, gpointer data) {
    GError *error = nullptr;
    if (GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error)) g_variant_unref(reply);
    if (!isCurrent(data)) {
        g_clear_error(&error);
        return;
    }
    if (!error) {
        answerSets(std::nullopt);
        return;
    }
    const Failure why = isMissing(error) ? Failure(NO_TRAY) : failure("crossbind: the desktop's status tray did not take the app's icon", error);
    g_error_free(error);
    disconnect();
    answerSets(why);
}

// A tray that started anew and did not take the icon back leaves it to the next start.
void registeredAgain(GObject *source, GAsyncResult *result, gpointer) {
    GError *error = nullptr;
    if (GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error)) g_variant_unref(reply);
    g_clear_error(&error);
}

// The tray takes the item by its path, the connection's own name being the bus's.
void registerItem(GAsyncReadyCallback answered) {
    g_dbus_connection_call(connection, WATCHER, WATCHER_PATH, WATCHER, "RegisterStatusNotifierItem", g_variant_new("(s)", ITEM_PATH), nullptr,
                           G_DBUS_CALL_FLAGS_NONE, -1, nullptr, answered, GUINT_TO_POINTER(generation));
}

// A watcher without a tray, as KDE's outside Plasma, would take the icon and show it nowhere. One that cannot tell is
// taken at its word.
void hostChecked(GObject *source, GAsyncResult *result, gpointer data) {
    GError *error = nullptr;
    GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
    bool hasTray = !isMissing(error);
    if (reply) {
        GVariant *value = nullptr;
        g_variant_get(reply, "(v)", &value);
        hasTray = !g_variant_is_of_type(value, G_VARIANT_TYPE_BOOLEAN) || g_variant_get_boolean(value);
        g_variant_unref(value);
        g_variant_unref(reply);
    }
    g_clear_error(&error);
    if (!isCurrent(data)) return;
    if (!hasTray) {
        disconnect();
        answerSets(NO_TRAY);
        return;
    }
    registerItem(registered);
}

void checkHost() {
    g_dbus_connection_call(connection, WATCHER, WATCHER_PATH, "org.freedesktop.DBus.Properties", "Get",
                           g_variant_new("(ss)", WATCHER, "IsStatusNotifierHostRegistered"), G_VARIANT_TYPE("(v)"), G_DBUS_CALL_FLAGS_NONE, -1,
                           nullptr, hostChecked, GUINT_TO_POINTER(generation));
}

// A tray that starts anew, as when the desktop's shell restarts, takes the icon again. The watch tells of the one there
// at first as well, which takes it.
void watcherAppeared(GDBusConnection *, const gchar *, const gchar *, gpointer) {
    if (std::exchange(isWatcherSeen, true)) registerItem(registeredAgain);
}

Failure connect() {
    GError *error = nullptr;
    gchar *address = g_dbus_address_get_for_bus_sync(G_BUS_TYPE_SESSION, nullptr, &error);
    if (address) {
        const auto flags = static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION);
        connection = g_dbus_connection_new_for_address_sync(address, flags, nullptr, nullptr, &error);
        g_free(address);
    }
    if (!connection) {
        const Failure why = failure("crossbind: the app has no session bus to show its tray icon on", error);
        g_clear_error(&error);
        return why;
    }
    static GDBusNodeInfo *item = g_dbus_node_info_new_for_xml(ITEM_XML, nullptr);
    static GDBusNodeInfo *menu = g_dbus_node_info_new_for_xml(MENU_XML, nullptr);
    itemObject = g_dbus_connection_register_object(connection, ITEM_PATH, item->interfaces[0], &ITEM_CALLS, nullptr, nullptr, &error);
    if (itemObject) menuObject = g_dbus_connection_register_object(connection, MENU_PATH, menu->interfaces[0], &MENU_CALLS, nullptr, nullptr, &error);
    if (!menuObject) {
        const Failure why = failure("crossbind: the tray's icon cannot go on the session bus", error);
        g_clear_error(&error);
        disconnect();
        return why;
    }
    isWatcherSeen = false;
    watcherWatch = g_bus_watch_name_on_connection(connection, WATCHER, G_BUS_NAME_WATCHER_FLAGS_NONE, watcherAppeared, nullptr, nullptr, nullptr);
    return std::nullopt;
}

// A tray reads its item's properties anew on a signal of the item's, and the menu on LayoutUpdated.
void announceChanges() {
    g_dbus_connection_emit_signal(connection, nullptr, MENU_PATH, MENU_INTERFACE, "LayoutUpdated", g_variant_new("(ui)", revision, 0), nullptr);
    g_dbus_connection_emit_signal(connection, nullptr, ITEM_PATH, ITEM_INTERFACE, "NewToolTip", nullptr, nullptr);
    GVariantBuilder changed;
    g_variant_builder_init(&changed, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&changed, "{sv}", "ToolTip", toolTip());
    g_variant_builder_add(&changed, "{sv}", "Menu", menuPath());
    g_dbus_connection_emit_signal(connection, nullptr, ITEM_PATH, "org.freedesktop.DBus.Properties", "PropertiesChanged",
                                  g_variant_new("(s@a{sv}@as)", ITEM_INTERFACE, g_variant_builder_end(&changed), g_variant_new_strv(nullptr, 0)),
                                  nullptr);
}

}  // namespace

// The tray answers once it took the icon, and rejects when the desktop has none; a set before it answered answers with
// the first.
void setTray(TrayOptions options, MenuClicked clicked, std::function<void(Failure)> done) {
    onMainThread([options = std::move(options), clicked = std::move(clicked), done = std::move(done)] {
        setEntries(options.menu);
        tooltip = options.tooltip;
        onClick = clicked;
        if (connection) {
            announceChanges();
            if (waitingSets.empty()) {
                done(std::nullopt);
            } else {
                waitingSets.push_back(done);
            }
            return;
        }
        if (const Failure failed = connect()) {
            done(failed);
            return;
        }
        waitingSets.push_back(done);
        checkHost();
    });
}

void removeTray(std::function<void(Failure)> done) {
    onMainThread([done = std::move(done)] {
        disconnect();
        answerSets(std::nullopt);
        done(std::nullopt);
    });
}

# A Linux desktop's status tray and notification server for e2e/run.mjs, on the run's own session bus. It takes the
# app's icon as KDE's tray does, checks what the icon and its menu carry against the tray and notification src/main.js
# sets, which run.mjs hands over, and once run.mjs writes a line clicks the icon, the menu's first item with checked and
# the notification. It tells what it finds in lines of its output: READY, READ, CLICKED, REMOVED and FAIL with why.
import json
import os
import sys

import gi

gi.require_version('Gio', '2.0')
gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib

WATCHER = 'org.kde.StatusNotifierWatcher'
NOTIFICATIONS = 'org.freedesktop.Notifications'
NOTIFICATIONS_PATH = '/org/freedesktop/Notifications'
ITEM_INTERFACE = 'org.kde.StatusNotifierItem'
MENU_INTERFACE = 'com.canonical.dbusmenu'
CALL_TIMEOUT_MS = 5000
NOTIFICATION_ID = 7
NODE_XML = '''<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
    <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
  </interface>
  <interface name="org.freedesktop.Notifications">
    <method name="GetCapabilities"><arg type="as" direction="out"/></method>
    <method name="Notify">
      <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/>
      <arg type="s" direction="in"/><arg type="as" direction="in"/><arg type="a{sv}" direction="in"/><arg type="i" direction="in"/>
      <arg type="u" direction="out"/>
    </method>
    <method name="CloseNotification"><arg type="u" direction="in"/></method>
    <method name="GetServerInformation">
      <arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/>
    </method>
    <signal name="ActionInvoked"><arg type="u"/><arg type="s"/></signal>
    <signal name="NotificationClosed"><arg type="u"/><arg type="u"/></signal>
  </interface>
</node>'''

expected = json.loads(sys.argv[1])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
state = {'item': None, 'clickable': None, 'notification': None}


def say(line):
    print(f'TRAY HOST {line}', flush=True)


def fail(problem):
    say(f'FAIL: {problem}')


def call(name, path, interface, method, parameters, reply):
    answer = bus.call_sync(name, path, interface, method, parameters, GLib.VariantType(reply) if reply else None,
                           Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, None)
    return answer.unpack() if reply else None


# The menu as dbusmenu lays it out, against the items src/main.js set, which a label's underscore doubles in.
def check_menu(items, children, where):
    if len(children) != len(items):
        fail(f'{where} has {len(children)} items, not {len(items)}')
        return
    for item, (item_id, properties, below) in zip(items, children):
        if item.get('type') == 'separator':
            if properties.get('type') != 'separator':
                fail(f'{where} shows {properties} for a separator')
            continue
        label = item['label']
        if properties.get('label') != label.replace('_', '__'):
            fail(f'{where} shows {properties.get("label")!r} for {label!r}')
        if properties.get('enabled', True) != item.get('enabled', True):
            fail(f'{label} shows enabled {properties.get("enabled", True)}')
        if 'items' in item:
            if properties.get('children-display') != 'submenu':
                fail(f'{label} is no submenu: {properties}')
            check_menu(item['items'], below, label)
        if 'checked' in item:
            if properties.get('toggle-type') != 'checkmark' or properties.get('toggle-state') != int(item['checked']):
                fail(f'{label} shows {properties} for checked {item["checked"]}')
            if state['clickable'] is None:
                state['clickable'] = (item_id, item)


def check_item():
    name, path = state['item']
    (properties,) = call(name, path, 'org.freedesktop.DBus.Properties', 'GetAll', GLib.Variant('(s)', (ITEM_INTERFACE,)),
                         '(a{sv})')
    if properties.get('Status') != 'Active' or not properties.get('Id') or not properties.get('Title'):
        fail(f'the icon carries {properties}')
    if properties.get('ToolTip', ('', [], '', ''))[2] != expected['tray']['tooltip']:
        fail(f'the icon shows the tooltip {properties.get("ToolTip")}')
    icon = os.path.join(properties.get('IconThemePath', ''), f'{properties.get("IconName", "")}.png')
    if not os.path.isfile(icon):
        fail(f'the icon names {icon}, which is no file')
    if properties.get('Menu') != '/MenuBar':
        fail(f'the icon names the menu {properties.get("Menu")}')
        return
    _, (_, _, children) = call(name, properties['Menu'], MENU_INTERFACE, 'GetLayout', GLib.Variant('(iias)', (0, -1, [])),
                               '(u(ia{sv}av))')
    check_menu(expected['tray']['menu'], children, 'the menu')
    say('READ')


# A tray takes an item by its path on the bus name of whoever registers it, or by its bus name at the usual path.
def registered(sender, service):
    state['item'] = (sender, service) if service.startswith('/') else (service, '/StatusNotifierItem')
    try:
        check_item()
    except GLib.Error as error:
        fail(f'the icon could not be read: {error.message}')
    Gio.bus_watch_name_on_connection(bus, state['item'][0], Gio.BusNameWatcherFlags.NONE, None, lambda *_: say('REMOVED'))
    return GLib.SOURCE_REMOVE


def check_notification(arguments):
    app_name, _, icon, summary, body, actions, _, _ = arguments
    shown = expected['notification']
    markup = shown['body'].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    if not app_name or not icon.startswith('file://') or summary != shown['title'] or body != markup:
        fail(f'the notification came as {arguments}')
    if 'default' not in actions[::2]:
        fail(f'the notification has no default action: {actions}')


def answer(connection, sender, path, interface, method, parameters, invocation):
    try:
        if method == 'RegisterStatusNotifierItem':
            invocation.return_value(None)
            GLib.idle_add(registered, sender, parameters.unpack()[0])
        elif method == 'GetCapabilities':
            invocation.return_value(GLib.Variant('(as)', (['actions', 'body', 'body-markup'],)))
        elif method == 'Notify':
            check_notification(parameters.unpack())
            state['notification'] = NOTIFICATION_ID
            invocation.return_value(GLib.Variant('(u)', (NOTIFICATION_ID,)))
        elif method == 'GetServerInformation':
            invocation.return_value(GLib.Variant('(ssss)', ('crossbind e2e', 'crossbind', '1', '1.2')))
        else:
            invocation.return_value(None)
    except Exception as error:
        fail(f'{method} failed: {error!r}')


def watcher_property(connection, sender, path, interface, name):
    items = [f'{state["item"][0]}{state["item"][1]}'] if state['item'] else []
    return {
        'RegisteredStatusNotifierItems': GLib.Variant('as', items),
        'IsStatusNotifierHostRegistered': GLib.Variant('b', True),
        'ProtocolVersion': GLib.Variant('i', 0),
    }[name]


def click():
    if not state['item'] or not state['clickable'] or not state['notification']:
        fail(f'there was nothing to click: {state}')
        return
    name, path = state['item']
    call(name, path, ITEM_INTERFACE, 'Activate', GLib.Variant('(ii)', (0, 0)), None)
    item_id, item = state['clickable']
    call(name, '/MenuBar', MENU_INTERFACE, 'Event', GLib.Variant('(isvu)', (item_id, 'clicked', GLib.Variant('i', 0), 0)), None)
    (toggled,) = call(name, '/MenuBar', MENU_INTERFACE, 'GetProperty', GLib.Variant('(is)', (item_id, 'toggle-state')), '(v)')
    if toggled != int(not item['checked']):
        fail(f'{item["label"]} shows the toggle state {toggled} after its click')
    bus.emit_signal(None, NOTIFICATIONS_PATH, NOTIFICATIONS, 'ActionInvoked', GLib.Variant('(us)', (state['notification'], 'default')))
    say('CLICKED')


def read_line(fd, condition):
    if not sys.stdin.readline():
        loop.quit()
        return GLib.SOURCE_REMOVE
    try:
        click()
    except GLib.Error as error:
        fail(f'the clicks failed: {error.message}')
    return GLib.SOURCE_CONTINUE


owned = set()


def acquired(connection, name):
    owned.add(name)
    if len(owned) == 2:
        say('READY')


def lost(connection, name):
    fail(f'the bus did not give the run {name}')
    loop.quit()


info = Gio.DBusNodeInfo.new_for_xml(NODE_XML)
bus.register_object('/StatusNotifierWatcher', info.interfaces[0], answer, watcher_property, None)
bus.register_object(NOTIFICATIONS_PATH, info.interfaces[1], answer, None, None)
for owned_name in (WATCHER, NOTIFICATIONS):
    Gio.bus_own_name_on_connection(bus, owned_name, Gio.BusNameOwnerFlags.NONE, acquired, lost)
GLib.io_add_watch(sys.stdin.fileno(), GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN | GLib.IOCondition.HUP, read_line)
loop.run()

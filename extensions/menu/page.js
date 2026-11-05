import { checkedOptions, invoke } from 'crossbind/app/core';

// The app's menus, its tray icon and its notifications, as a page calls them.
// A menu of the bar is { label, items } or a standard one by its role. An item is { label, id, accelerator, enabled,
// checked }, a submenu { label, items }, { type: 'separator' }, or a standard item by its role, which a label may
// rename and, but for an editing one, which keeps the platform's keys, an accelerator change.
const MENU_ROLES = ['editMenu', 'windowMenu'];
const EDITING_ROLES = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];
const ITEM_ROLES = [...EDITING_ROLES, 'minimize', 'close', 'quit'];
const ITEM_KINDS = {
    label: 'string', id: 'string', accelerator: 'string', enabled: 'boolean', checked: 'boolean', items: 'list', role: 'string', type: 'string',
};
const MODIFIERS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-2])|Enter|Escape|Tab|Space|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown|Plus|Minus|Comma|Period)$/;

// Typing uses neither a key with CmdOrCtrl, Ctrl or Alt nor a function key.
function checkAccelerator(accelerator, where, name) {
    const modifiers = accelerator.split('+');
    const key = modifiers.pop();
    const isKnown = KEY.test(key) && modifiers.every((modifier) => MODIFIERS.includes(modifier)) && new Set(modifiers).size === modifiers.length;
    if (!isKnown || !(/^F\d+$/.test(key) || modifiers.some((modifier) => modifier !== 'Shift'))) {
        throw new TypeError(`crossbind: ${name}'s ${where}.accelerator ${JSON.stringify(accelerator)} is none, which is a key with CmdOrCtrl, Ctrl or Alt and maybe Shift, joined by +, as CmdOrCtrl+Shift+O is, or F1 to F12, alone or with any of them.`);
    }
}

function checkMenuItem(item, where, isMenu, name = 'menu.set') {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`crossbind: ${name}'s ${where} is no object.`);
    for (const [key, value] of Object.entries(item)) {
        if (!Object.hasOwn(ITEM_KINDS, key)) throw new TypeError(`crossbind: ${name}'s ${where} takes ${Object.keys(ITEM_KINDS).join(', ')}; ${key} is none of them.`);
        const kind = ITEM_KINDS[key];
        if (value !== undefined && !(kind === 'list' ? Array.isArray(value) : typeof value === kind)) {
            throw new TypeError(`crossbind: ${name}'s ${where}.${key} is no ${kind}.`);
        }
    }
    const has = (...keys) => keys.filter((key) => item[key] !== undefined);
    const refuse = (what) => {
        throw new TypeError(`crossbind: ${name}'s ${where} ${what}.`);
    };
    if (item.type !== undefined) {
        if (item.type !== 'separator' || isMenu || has(...Object.keys(ITEM_KINDS)).length > 1) refuse("is no separator, which is { type: 'separator' } alone, inside a menu");
    } else if (item.role !== undefined) {
        const roles = isMenu ? MENU_ROLES : [...ITEM_ROLES, ...MENU_ROLES];
        if (!roles.includes(item.role)) refuse(`has no role ${JSON.stringify(item.role)}, which is one of ${roles.join(', ')}`);
        if (MENU_ROLES.includes(item.role) && has('id', 'accelerator', 'enabled', 'checked', 'items').length > 0) refuse('is a standard menu, which takes a label alone');
        if (EDITING_ROLES.includes(item.role) && item.accelerator !== undefined) refuse("is an editing item, which keeps the platform's keys and takes a label alone");
        if (has('id', 'enabled', 'checked', 'items').length > 0) refuse('has a role, which takes a label and an accelerator alone');
    } else if (!item.label) {
        refuse('has no label');
    } else if (item.items !== undefined) {
        if (has('id', 'accelerator', 'enabled', 'checked').length > 0) refuse('is a menu, which takes a label and items alone');
        // entries() reads a hole as undefined, which forEach skips.
        for (const [index, child] of item.items.entries()) checkMenuItem(child, `${where}.items[${index}]`, false, name);
    } else if (isMenu) {
        refuse('is a menu, which takes a label and items, or the role editMenu or windowMenu');
    }
    if (item.accelerator !== undefined) checkAccelerator(item.accelerator, where, name);
}

function checkedMenus(menus) {
    if (!Array.isArray(menus)) throw new TypeError('crossbind: menu.set takes a list of menus.');
    for (const [index, item] of menus.entries()) checkMenuItem(item, `menus[${index}]`, true);
    return { menus };
}

// A popup's items are those of one of menu.set's menus.
function checkedPopup(items, at) {
    if (!Array.isArray(items)) throw new TypeError('crossbind: menu.popup takes a list of items.');
    for (const [index, item] of items.entries()) checkMenuItem(item, `items[${index}]`, false, 'menu.popup');
    if (at === null || typeof at !== 'object' || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        throw new TypeError("crossbind: menu.popup takes the point it opens at, { x, y }, in the page's CSS pixels from its top left, as a contextmenu event's clientX and clientY are.");
    }
    return { items, x: at.x, y: at.y };
}

// A tray item is { label, id, enabled, checked }, a submenu { label, items } or { type: 'separator' }: a tray's menu has
// no keys, and no standard item, as the Dock's menu has none.
const TRAY = { tooltip: 'string', menu: { isFitting: Array.isArray, name: 'list' } };
const TRAY_ITEM = { label: 'string', id: 'string', enabled: 'boolean', checked: 'boolean', items: 'list', type: 'string' };
const NOTIFICATION = { title: 'string', body: 'string' };

function checkTrayItem(item, where, name = 'tray.set') {
    const refuse = (what) => {
        throw new TypeError(`crossbind: ${name}'s ${where} ${what}.`);
    };
    if (item === null || typeof item !== 'object' || Array.isArray(item)) refuse('is no object');
    for (const [key, value] of Object.entries(item)) {
        if (!Object.hasOwn(TRAY_ITEM, key)) refuse(`takes ${Object.keys(TRAY_ITEM).join(', ')}; ${key} is none of them`);
        const kind = TRAY_ITEM[key];
        if (value !== undefined && !(kind === 'list' ? Array.isArray(value) : typeof value === kind)) refuse(`.${key} is no ${kind}`);
    }
    const others = Object.keys(item).filter((key) => key !== 'type' && item[key] !== undefined);
    if (item.type !== undefined) {
        if (item.type !== 'separator' || others.length > 0) refuse("is no separator, which is { type: 'separator' } alone");
    } else if (!item.label) {
        refuse('has no label');
    } else if (item.items !== undefined) {
        if (others.some((key) => key !== 'label' && key !== 'items')) refuse('is a menu, which takes a label and items alone');
        // entries() reads a hole as undefined, which forEach skips.
        for (const [index, child] of item.items.entries()) checkTrayItem(child, `${where}.items[${index}]`, name);
    }
}

function checkedTray(options) {
    checkedOptions('tray.set', options, TRAY);
    for (const [index, item] of (options.menu ?? []).entries()) checkTrayItem(item, `menu[${index}]`);
    return options;
}

function checkedDock(items) {
    if (!Array.isArray(items)) throw new TypeError('crossbind: menu.setDock takes a list of items.');
    for (const [index, item] of items.entries()) checkTrayItem(item, `items[${index}]`, 'menu.setDock');
    return { items };
}

function checkedNotification(options) {
    checkedOptions('notification.show', options, NOTIFICATION);
    if (!options.title) throw new TypeError('crossbind: notification.show takes a title.');
    return options;
}

export const menu = {
    // Sets the app's menus: on macOS after its app menu, which the app keeps, and on Windows and Linux in a bar of its
    // window. A click of an item with an id is an event, menu, of { id }, and of { id, checked } for an item it checked
    // or unchecked; a standard item does what its role says.
    set: async (menus) => invoke('menu.set', checkedMenus(menus)),
    // Opens a menu of these items at the page's point, on the desktop, as a right click's menu opens: it resolves with
    // the id of the item clicked, or null when the menu closes without one, and a standard item does what its role says.
    // A contextmenu listener that opens it keeps the webview's own menu away with preventDefault().
    popup: async (items, at) => invoke('menu.popup', checkedPopup(items, at)),
    // Sets the menu a macOS app's Dock icon shows above the system's own items, of a tray's items; a click of an item
    // with an id is the event menu, as one of menu.set's is. An empty list takes it away.
    setDock: async (items) => invoke('menu.setDock', checkedDock(items)),
};

export const tray = {
    // The app's icon in the macOS menu bar, the Windows notification area or a Linux desktop's status tray, with its
    // tooltip and the menu a click opens. A click of an item with an id is the event menu, as one of menu.set's is, and a
    // click of the icon the event tray where it opens no menu. Set again, it changes the icon that shows.
    set: async (options = {}) => invoke('tray.set', checkedTray(options)),
    // Takes the icon away.
    remove: async () => invoke('tray.remove', {}),
};

export const notification = {
    // A notification of the system's, with a title and a body; a click on it is the event notification.
    show: async (options) => invoke('notification.show', checkedNotification(options)),
};


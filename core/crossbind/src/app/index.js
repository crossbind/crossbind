// What an app's host does for its page: the dialogs that pick files or show a message, opening an address or a file
// outside the app, the app's folders, quitting, its menus, the events of the app's native code and a desktop app's
// updates. Each call goes to the host of an app (target.runtimeEnv: 'app'); in any other build it rejects, or events.on
// throws. The app's native code calls the same through <crossbind/app.h>, but for the menus and events.on.

const OPEN = { title: 'string', defaultPath: 'string', filters: 'filters', directory: 'boolean', multiple: 'boolean' };
const SAVE = { title: 'string', defaultPath: 'string', defaultName: 'string', filters: 'filters' };
const MESSAGE = { message: 'string', detail: 'string', kind: 'string', buttons: 'buttons' };
const MESSAGE_KINDS = ['info', 'warning', 'error'];
// Android's dialogs take three buttons at most.
const MAX_BUTTONS = 3;

// The app's crossbind.js, which initNative() loads, hands the calls to the host.
function hostOf(member, name) {
    const host = globalThis.Crossbind?.[member];
    if (host) return host;
    if (globalThis.Crossbind) throw new Error(`crossbind: this app's host is older than crossbind/app; update @crossbind/core-app-host to call ${name}`);
    if (globalThis.__crossbind_token) throw new Error(`crossbind: ${name} works once the page has called initNative()`);
    throw new Error(`crossbind: ${name} works in an app alone, whose crossbind.config.js sets target.runtimeEnv: 'app'`);
}

const call = (name, options) => hostOf('app', name)(name, options);

const isFilters = (value) => Array.isArray(value) && value.every((filter) => typeof filter?.name === 'string'
    && Array.isArray(filter.extensions) && filter.extensions.every((extension) => typeof extension === 'string'));

// Spread reads a hole as undefined, which every() skips.
const isButtons = (value) => Array.isArray(value) && value.length >= 1 && value.length <= MAX_BUTTONS
    && [...value].every((label) => typeof label === 'string' && label !== '');

// The lists an option may be, beside what typeof tells: how each is checked, and what it is called.
const LISTS = {
    filters: { isFitting: isFilters, name: 'list of { name, extensions }' },
    buttons: { isFitting: isButtons, name: 'list of one to three labels' },
};

// The options as the host takes them, so a misspelt or mistyped one fails here, saying which.
function checked(name, options, kinds) {
    const keys = Object.keys(kinds).join(', ');
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError(`crossbind: ${name} takes an object of ${keys}.`);
    }
    for (const [key, value] of Object.entries(options)) {
        if (!Object.hasOwn(kinds, key)) throw new TypeError(`crossbind: ${name} takes ${keys}; ${key} is none of them.`);
        const list = LISTS[kinds[key]];
        if (value !== undefined && !(list ? list.isFitting(value) : typeof value === kinds[key])) {
            throw new TypeError(`crossbind: ${name}'s ${key} is no ${list ? list.name : kinds[key]}.`);
        }
    }
    return options;
}

function checkedMessage(options) {
    checked('dialog.message', options, MESSAGE);
    if (!options.message) throw new TypeError('crossbind: dialog.message takes a message.');
    if (options.kind !== undefined && !MESSAGE_KINDS.includes(options.kind)) {
        throw new TypeError(`crossbind: dialog.message's kind is info, warning or error, not ${JSON.stringify(options.kind)}.`);
    }
    return options;
}

function checkedPath(name, path) {
    if (typeof path !== 'string' || !path) throw new TypeError(`crossbind: ${name} takes a path.`);
    return { path };
}

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
function checkAccelerator(accelerator, where) {
    const modifiers = accelerator.split('+');
    const key = modifiers.pop();
    const isKnown = KEY.test(key) && modifiers.every((modifier) => MODIFIERS.includes(modifier)) && new Set(modifiers).size === modifiers.length;
    if (!isKnown || !(/^F\d+$/.test(key) || modifiers.some((modifier) => modifier !== 'Shift'))) {
        throw new TypeError(`crossbind: menu.set's ${where}.accelerator ${JSON.stringify(accelerator)} is none, which is a key with CmdOrCtrl, Ctrl or Alt and maybe Shift, joined by +, as CmdOrCtrl+Shift+O is, or F1 to F12, alone or with any of them.`);
    }
}

function checkMenuItem(item, where, isMenu) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`crossbind: menu.set's ${where} is no object.`);
    for (const [key, value] of Object.entries(item)) {
        if (!Object.hasOwn(ITEM_KINDS, key)) throw new TypeError(`crossbind: menu.set's ${where} takes ${Object.keys(ITEM_KINDS).join(', ')}; ${key} is none of them.`);
        const kind = ITEM_KINDS[key];
        if (value !== undefined && !(kind === 'list' ? Array.isArray(value) : typeof value === kind)) {
            throw new TypeError(`crossbind: menu.set's ${where}.${key} is no ${kind}.`);
        }
    }
    const has = (...keys) => keys.filter((key) => item[key] !== undefined);
    const refuse = (what) => {
        throw new TypeError(`crossbind: menu.set's ${where} ${what}.`);
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
        for (const [index, child] of item.items.entries()) checkMenuItem(child, `${where}.items[${index}]`, false);
    } else if (isMenu) {
        refuse('is a menu, which takes a label and items, or the role editMenu or windowMenu');
    }
    if (item.accelerator !== undefined) checkAccelerator(item.accelerator, where);
}

function checkedMenus(menus) {
    if (!Array.isArray(menus)) throw new TypeError('crossbind: menu.set takes a list of menus.');
    for (const [index, item] of menus.entries()) checkMenuItem(item, `menus[${index}]`, true);
    return { menus };
}

export const dialog = {
    // The paths of the files or folders the user picked, or null when they cancelled.
    open: async (options = {}) => call('dialog.open', checked('dialog.open', options, OPEN)),
    // The path the user chose to save to, or null when they cancelled.
    save: async (options = {}) => call('dialog.save', checked('dialog.save', options, SAVE)),
    // The index of the button the user clicked: Return gives the first, and Escape or closing the dialog the last.
    message: async (options) => call('dialog.message', checkedMessage(options)),
};

export const shell = {
    // An http, https or mailto address in the default browser or mail app.
    openExternal: async (url) => {
        if (typeof url !== 'string' && !(url instanceof URL)) throw new TypeError('crossbind: shell.openExternal takes an address.');
        return call('shell.openExternal', { url: String(url) });
    },
    // A file in the app the system opens its kind with. Opening a program runs it, and a script in the page could ask for
    // any path, so the host opens files where app.openPath in crossbind.config.js lets it alone; native code opens any.
    openPath: async (path) => call('shell.openPath', checkedPath('shell.openPath', path)),
    // A file, selected, in the system's file manager: one in the app's folders, or one a dialog picked during this run.
    revealInFolder: async (path) => call('shell.revealInFolder', checkedPath('shell.revealInFolder', path)),
    // A file or folder moved to the system's trash, where its user can take it back: one in the app's folders, not one of
    // them itself, or one a dialog picked during this run. Where the system has no trash, nothing moves.
    trash: async (path) => call('shell.trash', checkedPath('shell.trash', path)),
};

export const app = {
    // The app's own folders, made when first asked for: { data, cache, logs }.
    paths: async () => call('app.paths', {}),
    // Ends the app as closing its window does.
    quit: async () => call('app.quit', {}),
    // Ends the app as quit() does, then opens it again, with no link.
    relaunch: async () => call('app.relaunch', {}),
    // The links of app.urlSchemes that opened the app and have not reached the page yet, the one it was launched with
    // among them; later ones come as the event open-url. Listening first, then asking, misses none.
    launchUrls: async () => call('app.launchUrls', {}),
};

export const menu = {
    // Sets the app's menus: on macOS after its app menu, which the app keeps, and on Windows and Linux in a bar of its
    // window. A click of an item with an id is an event, menu, of { id }, and of { id, checked } for an item it checked
    // or unchecked; a standard item does what its role says.
    set: async (menus) => call('menu.set', checkedMenus(menus)),
};

export const events = {
    // Calls listener with the value of each event of this name the app's native code emits from now on, until the
    // function it returns is called.
    on: (name, listener) => {
        if (typeof name !== 'string' || !name) throw new TypeError('crossbind: events.on takes the name of an event.');
        if (typeof listener !== 'function') throw new TypeError('crossbind: events.on takes a function to call.');
        return hostOf('on', 'events.on')(name, listener);
    },
};

// One check or install runs at a time, and another rejects meanwhile.
export const updater = {
    // The version app.updater.url in crossbind.config.js offers when it is newer than the app's, as { version }, or null.
    check: async () => call('updater.check', {}),
    // Downloads that version, checks that the key of app.updater.publicKey signed it and installs it in place of the app,
    // which then quits and opens the new version. It rejects when that fails.
    install: async () => call('updater.install', {}),
};

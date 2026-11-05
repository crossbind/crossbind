// What an app's host does for its page: the dialogs that pick files or show a message, opening an address or a file
// outside the app, the app's folders, quitting, its windows, its menus, its tray icon and notifications, the events of
// the app's native code and a desktop app's updates. Each call goes to the host of an app (target.runtimeEnv: 'app'); in any
// other build it rejects, or events.on throws. The app's native code calls the same through <crossbind/app.h>, but for
// the windows, the menus, the tray, notifications and events.on.

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
    list: { isFitting: Array.isArray, name: 'list' },
    record: { isFitting: (value) => value !== null && typeof value === 'object' && !Array.isArray(value), name: 'object' },
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
const TRAY = { tooltip: 'string', menu: 'list' };
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
    checked('tray.set', options, TRAY);
    for (const [index, item] of (options.menu ?? []).entries()) checkTrayItem(item, `menu[${index}]`);
    return options;
}

function checkedDock(items) {
    if (!Array.isArray(items)) throw new TypeError('crossbind: menu.setDock takes a list of items.');
    for (const [index, item] of items.entries()) checkTrayItem(item, `items[${index}]`, 'menu.setDock');
    return { items };
}

// A user activity is { type, userInfo, webpageUrl }: NSUserActivity takes an http or https page alone.
const ACTIVITY = { type: 'string', userInfo: 'record', webpageUrl: 'string' };

function checkedActivity(activity) {
    if (activity === null) return {};
    checked('app.setUserActivity', activity, ACTIVITY);
    if (!activity.type) throw new TypeError('crossbind: app.setUserActivity takes a type, one of app.activityTypes.');
    const page = activity.webpageUrl;
    if (page !== undefined && !(URL.canParse(page) && ['http:', 'https:'].includes(new URL(page).protocol))) {
        throw new TypeError("crossbind: app.setUserActivity's webpageUrl is no http or https address.");
    }
    return activity;
}

// A window's options, as windows.open() takes them, and those windows.set() changes: sizes and places in logical pixels.
// A window opens in the middle of the screen without x and y, and set() moves one there with center.
const WINDOW_SIZES = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'];
const WINDOW_SHARED = {
    title: 'string', width: 'number', height: 'number', x: 'number', y: 'number', minWidth: 'number', minHeight: 'number',
    maxWidth: 'number', maxHeight: 'number', resizable: 'boolean', alwaysOnTop: 'boolean', fullscreen: 'boolean',
};
const WINDOW_SET = { ...WINDOW_SHARED, center: 'boolean' };
const WINDOW_OPEN = {
    ...WINDOW_SHARED, path: 'string', name: 'string', backgroundColor: 'string', frame: 'boolean', parent: 'number', modal: 'boolean',
};
const MAX_WINDOW_SIZE = 16384;
const MAX_WINDOW_PLACE = 1000000;
// The size a window opens at without one.
const WINDOW_SIZE = { width: 1024, height: 768 };
const COLOR = /^#[0-9a-f]{6}$/i;

const isWindowId = (id) => Number.isSafeInteger(id) && id >= 1;

function checkedWindow(name, options, kinds) {
    checked(name, options, kinds);
    const least = name === 'windows.set' ? 0 : 1;
    for (const key of WINDOW_SIZES) {
        const size = options[key];
        // A limit of 0 that windows.set() gives takes it away.
        const isFitting = Number.isInteger(size) && size >= ((key === 'width' || key === 'height') ? 1 : least) && size <= MAX_WINDOW_SIZE;
        if (size !== undefined && !isFitting) throw new TypeError(`crossbind: ${name}'s ${key} is no whole number of pixels up to ${MAX_WINDOW_SIZE}.`);
    }
    for (const key of ['x', 'y']) {
        const place = options[key];
        if (place !== undefined && !(Number.isInteger(place) && Math.abs(place) <= MAX_WINDOW_PLACE)) {
            throw new TypeError(`crossbind: ${name}'s ${key} is no whole number of pixels from -${MAX_WINDOW_PLACE} to ${MAX_WINDOW_PLACE}.`);
        }
    }
    if ((options.x === undefined) !== (options.y === undefined)) throw new TypeError(`crossbind: ${name} takes x and y together.`);
    const { path, backgroundColor, parent } = options;
    if (path !== undefined && (!path.startsWith('/') || path.startsWith('//') || path.split(/[?#]/, 1)[0].split('/').some((part) => DOT_PART.test(part) || part.includes('\\')))) {
        throw new TypeError(`crossbind: ${name}'s path ${JSON.stringify(path)} is no path of the app's own pages, as /settings.html is.`);
    }
    if (backgroundColor !== undefined && !COLOR.test(backgroundColor)) throw new TypeError(`crossbind: ${name}'s backgroundColor is no color of the form #rrggbb.`);
    if (parent !== undefined && !isWindowId(parent)) throw new TypeError(`crossbind: ${name}'s parent is no window's id.`);
    if (options.modal && parent === undefined) throw new TypeError(`crossbind: ${name} opens a modal window above a parent: give it parent, the id of a window.`);
    if (name === 'windows.open') checkedLimits(options);
    return options;
}

// The limits of a window that opens, as app.window takes them: those of one that resizes, around the size it opens at.
function checkedLimits(options) {
    const limits = ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'].filter((key) => options[key] !== undefined);
    if (options.resizable === false && limits.length > 0) {
        throw new TypeError(`crossbind: windows.open's ${limits.join(', ')} limit a window that resizes: drop them, or leave resizable true.`);
    }
    for (const [size, side] of [['width', 'Width'], ['height', 'Height']]) {
        const opensAt = options[size] ?? WINDOW_SIZE[size];
        if (options[`min${side}`] > opensAt) throw new TypeError(`crossbind: windows.open's min${side} is above the ${size} the window opens at, ${opensAt}.`);
        if (options[`max${side}`] < opensAt) throw new TypeError(`crossbind: windows.open's max${side} is below the ${size} the window opens at, ${opensAt}.`);
    }
}

// The window a call names by its id, or with none the calling page's own.
function windowOf(name, id) {
    if (id === undefined) return {};
    if (!isWindowId(id)) throw new TypeError(`crossbind: ${name} takes the id of a window, as windows.open() gives it, or none for the page's own.`);
    return { id };
}

function checkedNotification(options) {
    checked('notification.show', options, NOTIFICATION);
    if (!options.title) throw new TypeError('crossbind: notification.show takes a title.');
    return options;
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
    // Asks the app's extensions, as its user's Quit does, then ends the app as quit() does, unless one keeps it running.
    requestQuit: async () => call('app.requestQuit', {}),
    // Ends the app as quit() does, then opens it again, with no link.
    relaunch: async () => call('app.relaunch', {}),
    // The links of app.urlSchemes that opened the app and have not reached the page yet, the one it was launched with
    // among them, which the host holds as the events open-url; later ones come as the event. Listening first, then
    // asking, misses none.
    launchUrls: async () => (await events.held('open-url')).map((value) => value?.url).filter((url) => typeof url === 'string'),
    // The files the system opened the app with that have not reached the page yet, those no extension's type takes, the
    // launch's own among them, which the host holds as the events open-files; later ones come as the event.
    launchFiles: async () => (await events.held('open-files')).flatMap((value) => (Array.isArray(value?.paths) ? value.paths : []))
        .filter((path) => typeof path === 'string'),
    // The launch that started a desktop app: { args, cwd }, its arguments without the program's own and without the links
    // of the app's schemes, and the folder it was launched in. A phone's has neither.
    launchArgs: async () => call('app.launchArgs', {}),
    // Makes this user activity the app's current one on iOS and macOS, for its user's other devices to continue, as
    // Handoff does: { type, userInfo, webpageUrl }, its type one of app.activityTypes. null makes none current.
    setUserActivity: async (activity) => call('activities.set', checkedActivity(activity)),
};

export const windows = {
    // Opens a window of the app's own page at path, '/' by default, in front: { id, ignored }, its id and the options the
    // platform could not honour, which it opens without. A name already open brings that window to the front instead.
    // The other functions name a window by its id, and with none the calling page's own.
    open: async (options = {}) => call('windows.open', checkedWindow('windows.open', options, WINDOW_OPEN)),
    // Changes an open window: { ignored }, as open() gives it.
    set: async (id, options) => {
        const [named, changes] = typeof id === 'object' && options === undefined ? [undefined, id] : [id, options];
        return call('windows.set', { ...checkedWindow('windows.set', changes, WINDOW_SET), ...windowOf('windows.set', named) });
    },
    // Closes a window as its user does, which an extension may keep open.
    close: async (id) => call('windows.close', windowOf('windows.close', id)),
    // Brings a window to the front, restored if it was minimized.
    focus: async (id) => call('windows.focus', windowOf('windows.focus', id)),
    minimize: async (id) => call('windows.minimize', windowOf('windows.minimize', id)),
    toggleMaximize: async (id) => call('windows.toggleMaximize', windowOf('windows.toggleMaximize', id)),
    // Moves the page's window with the pointer, as its title bar does, from a mousedown of the primary button.
    startDrag: async () => call('windows.startDrag', {}),
    // The open windows, the oldest first, and the page's own: { id, name, title, x, y, width, height, isMaximized,
    // isMinimized, isFullscreen, isFocused }.
    list: async () => call('windows.list', {}),
    current: async () => call('windows.current', {}),
};

export const menu = {
    // Sets the app's menus: on macOS after its app menu, which the app keeps, and on Windows and Linux in a bar of its
    // window. A click of an item with an id is an event, menu, of { id }, and of { id, checked } for an item it checked
    // or unchecked; a standard item does what its role says.
    set: async (menus) => call('menu.set', checkedMenus(menus)),
    // Opens a menu of these items at the page's point, on the desktop, as a right click's menu opens: it resolves with
    // the id of the item clicked, or null when the menu closes without one, and a standard item does what its role says.
    // A contextmenu listener that opens it keeps the webview's own menu away with preventDefault().
    popup: async (items, at) => call('menu.popup', checkedPopup(items, at)),
    // Sets the menu a macOS app's Dock icon shows above the system's own items, of a tray's items; a click of an item
    // with an id is the event menu, as one of menu.set's is. An empty list takes it away.
    setDock: async (items) => call('menu.setDock', checkedDock(items)),
};

export const tray = {
    // The app's icon in the macOS menu bar, the Windows notification area or a Linux desktop's status tray, with its
    // tooltip and the menu a click opens. A click of an item with an id is the event menu, as one of menu.set's is, and a
    // click of the icon the event tray where it opens no menu. Set again, it changes the icon that shows.
    set: async (options = {}) => call('tray.set', checkedTray(options)),
    // Takes the icon away.
    remove: async () => call('tray.remove', {}),
};

export const notification = {
    // A notification of the system's, with a title and a body; a click on it is the event notification.
    show: async (options) => call('notification.show', checkedNotification(options)),
};

export const events = {
    // Calls listener with the value of each event of this name the app's native code emits from now on, until the
    // function it returns is called.
    on: (name, listener) => {
        if (typeof name !== 'string' || !name) throw new TypeError('crossbind: events.on takes the name of an event.');
        if (typeof listener !== 'function') throw new TypeError('crossbind: events.on takes a function to call.');
        return hostOf('on', 'events.on')(name, listener);
    },
    // The values of the events of this name the app's native code held for the page with holdEvent(), which came before
    // the page asked for them since it loaded; later ones come as the events while it listens. Listening first, then
    // asking, misses none.
    held: async (name) => {
        if (typeof name !== 'string' || !name) throw new TypeError('crossbind: events.held takes the name of an event.');
        return call('events.held', { name });
    },
};

// A function of one of the app's extensions, by its name, as clipboard.readText, with options of JSON values and bytes,
// a typed array, a DataView or an ArrayBuffer, whose result's bytes come back as a Uint8Array; an extension's own
// package calls it so. The host checks the options. onMessage gets each message the function sends before it answers,
// in order, all of them before invoke resolves; signal cancels the call, which then rejects with the signal's reason.
export const invoke = async (name, options = {}, { onMessage, signal } = {}) => {
    if (typeof name !== 'string' || !name) throw new TypeError("crossbind: invoke takes the name of one of the app's functions.");
    if (onMessage !== undefined && typeof onMessage !== 'function') throw new TypeError('crossbind: invoke takes onMessage as a function.');
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('crossbind: invoke takes signal as an AbortSignal.');
    const host = hostOf('app', name);
    // An older host would leave them out without a word.
    if (onMessage !== undefined || signal !== undefined) hostOf('takesMessages', 'invoke with onMessage or signal');
    return host(name, options, { onMessage, signal });
};

const EXTENSION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// A part of a path the URL would resolve away, escaped or not, to another extension's or the page's own.
const DOT_PART = /^(\.|%2e){1,2}$/i;
const ANDROID_ORIGIN = 'https://appassets.androidplatform.net';

// The URL of a path an extension's route serves, as "/clips/intro.mp4" or "/thumb/42?size=256", for the page's <img>,
// <video> or fetch(), as the URL holds it: what a path takes escaped, the caller escapes. The route gets it decoded.
// The app's own origin is an https one on Android, whose WebView serves no scheme of an app's.
export const routeUrl = (extension, path) => {
    if (typeof extension !== 'string' || !EXTENSION_NAME.test(extension)) throw new TypeError("crossbind: routeUrl takes the name of one of the app's extensions.");
    if (typeof path !== 'string' || !path.startsWith('/')) throw new TypeError('crossbind: routeUrl takes a path that starts with "/".');
    if (path.split(/[?#]/, 1)[0].split('/').some((part) => DOT_PART.test(part))) throw new TypeError('crossbind: routeUrl takes a path without a part "." or "..".');
    const isAndroid = Boolean(globalThis.__crossbind_port) || globalThis.location?.origin === ANDROID_ORIGIN;
    return `${isAndroid ? ANDROID_ORIGIN : 'crossbind://app'}/ext/${extension}${path}`;
};

// One check or install runs at a time, and another rejects meanwhile.
export const updater = {
    // The version app.updater.url in crossbind.config.js offers when it is newer than the app's, as { version }, or null.
    check: async () => call('updater.check', {}),
    // Downloads that version, checks that the key of app.updater.publicKey signed it and installs it in place of the app,
    // which then quits and opens the new version. It rejects when that fails.
    install: async () => call('updater.install', {}),
};

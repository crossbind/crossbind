// What an app's host does for its page: the app's folders, quitting, its windows, the events of the app's native code and
// the functions of its extensions, by their names. Each call goes to the host of an app (target.runtimeEnv: 'app'); in any
// other build it rejects, or events.on throws. A page imports these from crossbind/app, which an app's bundler plugin
// takes from the app host, with what crossbind's own extensions give the page, as crossbind/app/core alone holds these.

// The app's crossbind.js, which initNative() loads, hands the calls to the host.
function hostOf(member, name) {
    const host = globalThis.Crossbind?.[member];
    if (host) return host;
    if (globalThis.Crossbind) throw new Error(`crossbind: this app's host is older than crossbind/app; update @crossbind/core-app-host to call ${name}`);
    if (globalThis.__crossbind_token) throw new Error(`crossbind: ${name} works once the page has called initNative()`);
    throw new Error(`crossbind: ${name} works in an app alone, whose crossbind.config.js sets target.runtimeEnv: 'app'`);
}

const call = (name, options) => hostOf('app', name)(name, options);

// The options as the host takes them, so a misspelt or mistyped one fails here, saying which: each key's kind is what
// typeof gives, or { isFitting, name } for a list or an object, how it is checked and what it is called.
export function checkedOptions(name, options, kinds) {
    const keys = Object.keys(kinds).join(', ');
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError(`crossbind: ${name} takes an object of ${keys}.`);
    }
    for (const [key, value] of Object.entries(options)) {
        if (!Object.hasOwn(kinds, key)) throw new TypeError(`crossbind: ${name} takes ${keys}; ${key} is none of them.`);
        const kind = kinds[key];
        const isOfKind = typeof kind === 'string' ? typeof value === kind : kind.isFitting(value);
        if (value !== undefined && !isOfKind) throw new TypeError(`crossbind: ${name}'s ${key} is no ${typeof kind === 'string' ? kind : kind.name}.`);
    }
    return options;
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
    checkedOptions(name, options, kinds);
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

// What the app's host tells the page of where the app runs, from before the page's own scripts on.
function deviceOf(name) {
    const device = globalThis.__crossbind_device;
    if (device) return device[name];
    if (globalThis.__crossbind_token) throw new Error(`crossbind: this app's host is older than crossbind/app; update @crossbind/core-app-host to read device.${name}`);
    throw new Error(`crossbind: device.${name} works in an app alone, whose crossbind.config.js sets target.runtimeEnv: 'app'`);
}

// Where the app runs, the same through its run, which the page reads at once, as it starts: the platform and the arch
// the app is built for, what the device is to its user, its system's name and version, and whether a simulator or an
// emulator runs the app.
export const device = Object.freeze({
    get platform() { return deviceOf('platform'); },
    get arch() { return deviceOf('arch'); },
    get formFactor() { return deviceOf('formFactor'); },
    get os() { return deviceOf('os'); },
    get isVirtual() { return deviceOf('isVirtual'); },
});

export const app = {
    // The app's own folders, made when first asked for: { data, cache, logs }.
    paths: async () => call('app.paths', {}),
    // Ends the app as closing its window does.
    quit: async () => call('app.quit', {}),
    // Asks the app's extensions, as its user's Quit does, then ends the app as quit() does, unless one keeps it running.
    requestQuit: async () => call('app.requestQuit', {}),
    // Ends the app as quit() does, then opens it again, with no link.
    relaunch: async () => call('app.relaunch', {}),
    // The launch that started a desktop app: { args, cwd }, its arguments without the program's own and without the links
    // of the app's schemes, and the folder it was launched in. A phone's has neither.
    launchArgs: async () => call('app.launchArgs', {}),
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


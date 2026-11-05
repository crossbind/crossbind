// The app section of crossbind.config.js: what a user sees of an app, its name and, on the desktop, its window, and where
// its page opens files.
import { carriedPath } from './appFiles.js';

const WINDOW_DEFAULTS = { width: 1024, height: 768, minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0, resizable: true, fullscreen: false, backgroundColor: null };
// Larger than any display, and far within the int a host takes a size as.
const MAX_WINDOW_SIZE = 16384;
// Windows keeps each of a file version's four numbers in 16 bits.
const MAX_VERSION_NUMBER = 65535;
// Up to four numbers, then a semver prerelease or build part; none of its characters needs escaping in C or RC.
const WINDOWS_VERSION = /^(\d+(?:\.\d+){0,3})(?:[-+][0-9A-Za-z.+-]*)?$/;
// The platforms whose apps have a window of their own, and updates.
const DESKTOP = ['darwin', 'linux', 'win32'];
// Apple's app categories, which macOS shows an app under, each with the main categories of the freedesktop menu
// specification a Linux menu shows it under. An audio or a video app is in AudioVideo as well, as the specification asks.
const GAMES = ['', 'action-', 'adventure-', 'arcade-', 'board-', 'card-', 'casino-', 'dice-', 'educational-', 'family-', 'kids-', 'music-', 'puzzle-',
    'racing-', 'role-playing-', 'simulation-', 'sports-', 'strategy-', 'trivia-', 'word-'].map((kind) => `${kind}games`);
const APP_CATEGORIES = {
    business: 'Office', 'developer-tools': 'Development', education: 'Education', entertainment: 'AudioVideo', finance: 'Office',
    'graphics-design': 'Graphics', 'healthcare-fitness': 'Utility', lifestyle: 'Utility', medical: 'Science', music: 'Audio;AudioVideo', news: 'Network',
    photography: 'Graphics', productivity: 'Office', reference: 'Education', 'social-networking': 'Network', sports: 'Utility', travel: 'Utility',
    utilities: 'Utility', video: 'Video;AudioVideo', weather: 'Utility', ...Object.fromEntries(GAMES.map((category) => [category, 'Game'])),
};

// An app's bundle id, which also names its folders on the desktop: app.id, else one made from the project's name.
export function appId(config) {
    const id = config.app.id ?? `dev.crossbind.${config.general.name.replace(/[^A-Za-z0-9.-]/g, '-')}`;
    // An empty part would let "." or ".." name the folder above the app's own.
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(id)) {
        throw new Error(`crossbind: app.id ${JSON.stringify(id)} is no bundle id, which takes dot-separated parts of letters, digits and hyphens, as com.example.app does.`);
    }
    return id;
}

// An Android application id: dot-separated parts of letters, digits and underscores that each start with a letter.
const ANDROID_APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

// An Android app's id: the project's app.id, else one made from the project's name.
export function androidAppId(config) {
    const id = config.app.id ?? `dev.crossbind.${config.general.name.replace(/[^A-Za-z0-9.]/g, '_')}`;
    if (!ANDROID_APP_ID.test(id)) {
        throw new Error(`crossbind: ${JSON.stringify(id)} (app.id, else made from the project's name) is no Android application id, which takes dot-separated parts of letters, digits and underscores that each start with a letter, as com.example.app does. Set app.id in crossbind.config.js.`);
    }
    return id;
}

// The name the app shows: its window's title, its macOS menus, its Windows file description and the label under its
// icon. The project's name, without app.name.
export function appDisplayName(config) {
    const isOwn = config.app.name !== undefined;
    const name = isOwn ? config.app.name : config.general.name;
    // The host takes it as a C string and a Windows resource string, which hold none of these as they are, and Android
    // reads a label that starts with @ or ? as a resource.
    if (typeof name !== 'string' || !name.trim() || /["\\\p{Cc}]/u.test(name) || /^[@?]/.test(name)) {
        const rule = 'which is text without a quotation mark, a backslash or a control character, starting with neither @ nor ?';
        throw new Error(isOwn
            ? `crossbind: app.name ${JSON.stringify(name)} is no name an app can show, ${rule}. Change it, or drop app.name to show general.name.`
            : `crossbind: general.name ${JSON.stringify(name)}, which an app shows without app.name, is no name it can show, ${rule}. Set app.name in crossbind.config.js.`);
    }
    return name;
}

// The copyright line a macOS app's About panel and a Windows executable's details show: app.copyright, else none. The
// host takes it as a C string and a Windows resource string, as it takes the name.
export function appCopyright(config) {
    const copyright = config.app.copyright;
    if (copyright === undefined) return null;
    if (typeof copyright !== 'string' || !copyright.trim() || /["\\\p{Cc}]/u.test(copyright)) {
        throw new Error(`crossbind: app.copyright ${JSON.stringify(copyright)} is no copyright line, which is text without a quotation mark, a backslash or a control character, as '© 2026 Example Inc.' is.`);
    }
    return copyright;
}

// The category app.category names, under which macOS shows the app, and the ones a Linux menu shows it under; none
// without app.category.
export function appCategory(config) {
    const category = config.app.category;
    if (category === undefined) return null;
    if (!Object.hasOwn(APP_CATEGORIES, category)) {
        throw new Error(`crossbind: app.category ${JSON.stringify(category)} is none of Apple's app categories, which are ${Object.keys(APP_CATEGORIES).join(', ')}.`);
    }
    return { darwin: `public.app-category.${category}`, linux: APP_CATEGORIES[category] };
}

// The desktop window: the size of its page, the least it shrinks to and the most it grows to, whether it resizes and
// whether it opens full screen. Its backgroundColor, which a phone takes as well, is appBackgroundColor's.
export function appWindow(config) {
    const window = config.app.window ?? {};
    const keys = Object.keys(WINDOW_DEFAULTS).join(', ');
    if (typeof window !== 'object' || Array.isArray(window)) {
        throw new Error(`crossbind: app.window ${JSON.stringify(window)} is no object of ${keys}, as { width: 1024, height: 768 } is.`);
    }
    const unknown = Object.keys(window).filter((key) => !(key in WINDOW_DEFAULTS));
    if (unknown.length > 0) throw new Error(`crossbind: app.window takes ${keys}; ${unknown.join(', ')} is none of them.`);
    const options = { ...WINDOW_DEFAULTS, ...window };
    ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'].forEach((key) => {
        const least = /^(min|max)/.test(key) ? 0 : 1;
        if (!Number.isInteger(options[key]) || options[key] < least || options[key] > MAX_WINDOW_SIZE) {
            throw new Error(`crossbind: app.window.${key} ${JSON.stringify(options[key])} is no size, which is a whole number of pixels from ${least} to ${MAX_WINDOW_SIZE}.`);
        }
    });
    ['resizable', 'fullscreen'].forEach((key) => {
        if (typeof options[key] !== 'boolean') throw new Error(`crossbind: app.window.${key} ${JSON.stringify(options[key])} is no boolean: set it to true or false.`);
    });
    if (!options.resizable && (options.minWidth || options.minHeight || options.maxWidth || options.maxHeight)) {
        throw new Error('crossbind: app.window.minWidth, minHeight, maxWidth and maxHeight limit a window that resizes: drop them, or set app.window.resizable to true.');
    }
    [['width', 'Width'], ['height', 'Height']].forEach(([size, side]) => {
        const [least, most] = [options[`min${side}`], options[`max${side}`]];
        if (least > options[size]) {
            throw new Error(`crossbind: app.window.min${side} ${least} is above the ${size} the window opens with, ${options[size]}: lower it, or raise app.window.${size}.`);
        }
        if (most && most < options[size]) {
            throw new Error(`crossbind: app.window.max${side} ${most} is below the ${size} the window opens with, ${options[size]}: raise it, or lower app.window.${size}.`);
        }
    });
    return options;
}

// The color an app shows until its page paints, and behind a page without a background of its own, on iOS and Android as
// well: app.window.backgroundColor, else null, which leaves the system's.
export function appBackgroundColor(config) {
    const color = config.app.window?.backgroundColor ?? null;
    if (color !== null && (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color))) {
        throw new Error(`crossbind: app.window.backgroundColor ${JSON.stringify(color)} is no color of the form #rrggbb, as #1e1e1e is.`);
    }
    return color;
}

const PERMISSIONS = ['camera', 'microphone', 'location'];

// The devices the page may use, each with the reason for it, which macOS and iOS read from the Info.plist:
// app.permissions.
export function appPermissions(config) {
    const permissions = config.app.permissions ?? {};
    const names = PERMISSIONS.join(', ');
    if (typeof permissions !== 'object' || Array.isArray(permissions)) {
        throw new Error(`crossbind: app.permissions ${JSON.stringify(permissions)} is no object of ${names}, each with the reason the app uses it, as { camera: 'To scan barcodes' } is.`);
    }
    const unknown = Object.keys(permissions).filter((name) => !PERMISSIONS.includes(name));
    if (unknown.length > 0) throw new Error(`crossbind: app.permissions takes ${names}; ${unknown.join(', ')} is none of them.`);
    Object.entries(permissions).forEach(([name, reason]) => {
        if (typeof reason !== 'string' || !reason.trim() || /\p{Cc}/u.test(reason)) {
            throw new Error(`crossbind: app.permissions.${name} ${JSON.stringify(reason)} is no reason, which is text without control characters that the app's user reads when it asks for the ${name}, as 'To scan barcodes' is.`);
        }
    });
    return permissions;
}

// The reasons of app.permissions under the Info.plist keys macOS or iOS reads them from; macOS reads location's older
// key as well.
export function usageDescriptions(config, platform) {
    const keys = {
        camera: ['NSCameraUsageDescription'],
        microphone: ['NSMicrophoneUsageDescription'],
        location: ['NSLocationWhenInUseUsageDescription', ...(platform === 'darwin' ? ['NSLocationUsageDescription'] : [])],
    };
    return Object.fromEntries(Object.entries(appPermissions(config)).flatMap(([name, reason]) => keys[name].map((key) => [key, reason])));
}

// Apple's categories of required reason API, each with the type a privacy manifest names it by and the reasons Apple
// takes for it, from "Describing use of required reason API".
export const PRIVACY_CATEGORIES = {
    fileTimestamp: { type: 'NSPrivacyAccessedAPICategoryFileTimestamp', reasons: ['DDA9.1', 'C617.1', '3B52.1', '0A2A.1'] },
    systemBootTime: { type: 'NSPrivacyAccessedAPICategorySystemBootTime', reasons: ['35F9.1', '8FFB.1', '3D61.1'] },
    diskSpace: { type: 'NSPrivacyAccessedAPICategoryDiskSpace', reasons: ['85F4.1', 'E174.1', '7D9E.1', 'B728.1'] },
    activeKeyboards: { type: 'NSPrivacyAccessedAPICategoryActiveKeyboards', reasons: ['3EC4.1', '54BD.1'] },
    userDefaults: { type: 'NSPrivacyAccessedAPICategoryUserDefaults', reasons: ['CA92.1', '1C8F.1', 'C56D.1', 'AC6B.1'] },
};

// The reasons an iOS app's privacy manifest gives for the required reason API it calls: app.privacy, each category with
// Apple's reasons that fit, as { fileTimestamp: ['C617.1'] }.
export const appPrivacy = (config) => checkedPrivacy(config.app.privacy ?? {}, 'app.privacy');

// Reasons for Apple's required reason API, as app.privacy gives them and an extension's ios.privacy does.
export function checkedPrivacy(privacy, where) {
    const names = Object.keys(PRIVACY_CATEGORIES).join(', ');
    if (typeof privacy !== 'object' || privacy === null || Array.isArray(privacy)) {
        throw new Error(`crossbind: ${where} ${JSON.stringify(privacy)} is no object of ${names}, each with Apple's reasons for it, as { fileTimestamp: ['C617.1'] } is.`);
    }
    const unknown = Object.keys(privacy).filter((name) => !Object.hasOwn(PRIVACY_CATEGORIES, name));
    if (unknown.length > 0) throw new Error(`crossbind: ${where} takes ${names}; ${unknown.join(', ')} is none of them.`);
    Object.entries(privacy).forEach(([name, reasons]) => {
        const allowed = PRIVACY_CATEGORIES[name].reasons;
        if (!Array.isArray(reasons) || reasons.length === 0 || reasons.some((reason) => !allowed.includes(reason))) {
            throw new Error(`crossbind: ${where}.${name} ${JSON.stringify(reasons)} is no list of Apple's reasons for it, which are ${allowed.join(', ')}; Apple's "Describing use of required reason API" says what each covers.`);
        }
    });
    return privacy;
}

// Whether an iOS app uses encryption that export rules do not exempt, which its Info.plist tells App Store Connect so that
// it stops asking for every build: app.encryption. It is a legal statement, so there is none without it.
export function appEncryption(config) {
    const encryption = config.app.encryption;
    if (encryption === undefined) return null;
    if (typeof encryption !== 'boolean') {
        throw new Error(`crossbind: app.encryption ${JSON.stringify(encryption)} is no boolean: set it to false when the app uses no encryption, or only what export rules exempt as the system's HTTPS, and to true when it uses any other.`);
    }
    return encryption;
}

const IOS_OPTIONS = ['multipleWindows', 'appGroup'];
// An App Group of iOS's: group. and a bundle id's dot-separated parts.
const APP_GROUP = /^group(\.[A-Za-z0-9-]+)+$/;

function iosOptions(config) {
    const ios = config.app.ios ?? {};
    if (typeof ios !== 'object' || Array.isArray(ios)) {
        throw new Error(`crossbind: app.ios ${JSON.stringify(ios)} is no object of multipleWindows and appGroup, as { multipleWindows: true } is.`);
    }
    const unknown = Object.keys(ios).filter((key) => !IOS_OPTIONS.includes(key));
    if (unknown.length > 0) throw new Error(`crossbind: app.ios takes multipleWindows and appGroup; ${unknown.join(', ')} is none of them.`);
    return ios;
}

// Whether an iPad app's user, and its page, open more windows of it, as app.ios.multipleWindows says: iOS shows an
// iPhone's one window alone.
export function iosMultipleWindows(config) {
    const { multipleWindows = false } = iosOptions(config);
    if (typeof multipleWindows !== 'boolean') {
        throw new Error(`crossbind: app.ios.multipleWindows ${JSON.stringify(multipleWindows)} is no boolean: set it to true for an iPad app's windows, or leave it out.`);
    }
    return multipleWindows;
}

// The App Group an iOS app shares with the targets its extensions add, as app.ios.appGroup names it, else group. and the
// app's id.
export function iosAppGroup(config) {
    const { appGroup = `group.${appId(config)}` } = iosOptions(config);
    if (typeof appGroup !== 'string' || !APP_GROUP.test(appGroup)) {
        throw new Error(`crossbind: app.ios.appGroup ${JSON.stringify(appGroup)} is no App Group, which is group. and a bundle id's parts, as group.com.example.notes is.`);
    }
    return appGroup;
}

// The version a Windows app's executable carries: package.json's, whose numbers are its file version.
function windowsVersion(config) {
    const version = config.package?.version ?? '1.0.0';
    const match = typeof version === 'string' ? WINDOWS_VERSION.exec(version) : null;
    const numbers = match ? match[1].split('.').map(Number) : [];
    if (!match || numbers.some((number) => number > MAX_VERSION_NUMBER)) {
        throw new Error(`crossbind: package.json's version ${JSON.stringify(version)} is no version a Windows app can carry, which is up to four numbers from 0 to ${MAX_VERSION_NUMBER}, as 1.2.3 and 1.2.3-beta.1 are.`);
    }
    return { text: version, numbers: [...numbers, 0, 0, 0].slice(0, 4).join(',') };
}

// The files and folders of the project the app carries for its own native code, as app.files lists them: inside the
// project's folder, which keep their places in the app's files/.
export function appFiles(config) {
    const files = config.app.files ?? [];
    if (!Array.isArray(files)) throw new Error(`crossbind: app.files ${JSON.stringify(files)} is no list of the project's files and folders, as ['seed.sqlite'] is.`);
    const root = config.paths.project;
    return files.map((file) => carriedPath('app.files', root, file, "project's"));
}

// Schemes the web, the system or crossbind owns, which no app takes, and the keys of Windows' own classes, whose name a
// scheme's registry key would take.
const RESERVED_SCHEMES = [
    'about', 'blob', 'content', 'crossbind', 'data', 'file', 'ftp', 'http', 'https', 'intent', 'javascript', 'mailto', 'sms', 'tel', 'ws', 'wss',
    'appid', 'applications', 'clsid', 'directory', 'drive', 'folder', 'interface', 'mime', 'protocols', 'systemfileassociations', 'typelib', 'unknown',
    'wow6432node',
];

// The schemes of a list whose links open the app, as myapp://… does: lowercase, which is how Android matches them, and
// of two characters at least, as one would take a Windows path's drive for a scheme.
export function checkedUrlSchemes(schemes, where) {
    if (!Array.isArray(schemes)) {
        throw new Error(`crossbind: ${where} ${JSON.stringify(schemes)} is no list of schemes, as ['myapp'] is.`);
    }
    for (const scheme of schemes) {
        if (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]+$/.test(scheme)) {
            throw new Error(`crossbind: ${where} takes schemes of a lowercase letter, then one or more lowercase letters, digits, +, - and ., as myapp is; ${JSON.stringify(scheme)} is none.`);
        }
        if (RESERVED_SCHEMES.includes(scheme)) {
            throw new Error(`crossbind: ${where} cannot take ${scheme}, which the web or the system owns: pick a scheme of the app's own.`);
        }
    }
    if (new Set(schemes).size !== schemes.length) throw new Error(`crossbind: ${where} lists a scheme twice: ${JSON.stringify(schemes)}.`);
    return schemes;
}

const ownerName = (extension) => (extension === null ? 'app.urlSchemes' : `the extension ${extension}`);

// The schemes whose links open the app, each with the extension that declared it, whose native code gets its links, or
// null for those of app.urlSchemes, whose links the host's links hands the page. Two owners of one scheme stop the build,
// naming both.
export function urlSchemeOwners(config) {
    const owned = [
        ...checkedUrlSchemes(config.app.urlSchemes ?? [], 'app.urlSchemes').map((scheme) => ({ scheme, extension: null })),
        ...(config.extensions ?? []).flatMap(({ name, app }) => (app.urlSchemes ?? []).map((scheme) => ({ scheme, extension: name }))),
    ];
    owned.forEach(({ scheme, extension }, index) => {
        const first = owned.findIndex((other) => other.scheme === scheme);
        if (first !== index) {
            throw new Error(`crossbind: ${ownerName(owned[first].extension)} and ${ownerName(extension)} both claim the scheme ${scheme}, whose links one alone gets.`);
        }
    });
    return owned;
}

// The schemes whose links open the app: app.urlSchemes's, then its extensions'.
export const appUrlSchemes = (config) => urlSchemeOwners(config).map(({ scheme }) => scheme);

// The installers app.installers names, which alone of each desktop platform's make what installs its app; null without
// it, when every one does.
export function appInstallers(config) {
    const { installers } = config.app;
    if (installers === undefined) return null;
    if (!Array.isArray(installers) || !installers.every((name) => typeof name === 'string') || new Set(installers).size !== installers.length) {
        throw new Error(`crossbind: app.installers ${JSON.stringify(installers)} is no list of installers' names, each once.`);
    }
    return installers;
}

// A desktop host's window: its page's size and limits, whether it resizes and whether it opens full screen. A maximum of
// one side alone leaves the other as large as any display.
function windowDefines(window) {
    const most = window.maxWidth || window.maxHeight ? [
        `#define CROSSBIND_APP_WINDOW_MAX_WIDTH ${window.maxWidth || MAX_WINDOW_SIZE}`,
        `#define CROSSBIND_APP_WINDOW_MAX_HEIGHT ${window.maxHeight || MAX_WINDOW_SIZE}`,
    ] : [];
    return [
        `#define CROSSBIND_APP_WINDOW_WIDTH ${window.width}`,
        `#define CROSSBIND_APP_WINDOW_HEIGHT ${window.height}`,
        `#define CROSSBIND_APP_WINDOW_MIN_WIDTH ${window.minWidth}`,
        `#define CROSSBIND_APP_WINDOW_MIN_HEIGHT ${window.minHeight}`,
        `#define CROSSBIND_APP_WINDOW_RESIZABLE ${window.resizable ? 1 : 0}`,
        ...most,
        ...(window.fullscreen ? ['#define CROSSBIND_APP_WINDOW_FULLSCREEN 1'] : []),
    ];
}

// The header an app's host compiles its id and name with, an iOS or desktop host the color it shows until its page paints
// and the devices the page may use, an iOS host the App Group of its extensions' targets, a desktop host its window, and a
// Windows host its version resource.
export function appHeader(config, platform, appGroup = null) {
    const comment = '// crossbind writes this file from crossbind.config.js and package.json.';
    const id = `#define CROSSBIND_APP_ID "${platform === 'android' ? androidAppId(config) : appId(config)}"`;
    const name = `#define CROSSBIND_APP_NAME "${appDisplayName(config)}"`;
    const color = appBackgroundColor(config);
    const permissions = appPermissions(config);
    // An Android app's activity takes the color and the permissions from its Gradle project.
    const page = platform === 'android' ? [] : [
        ...(color ? [`#define CROSSBIND_APP_BACKGROUND_COLOR 0x${color.slice(1).toLowerCase()}`] : []),
        ...PERMISSIONS.map((name) => `#define CROSSBIND_APP_PERMISSION_${name.toUpperCase()} ${name in permissions ? 1 : 0}`),
    ];
    const windows = platform === 'ios' && iosMultipleWindows(config) ? ['#define CROSSBIND_APP_IOS_MULTIPLE_WINDOWS 1'] : [];
    const group = platform === 'ios' && appGroup ? [`#define CROSSBIND_APP_GROUP "${appGroup}"`] : [];
    if (!DESKTOP.includes(platform)) return [comment, ...page, ...windows, ...group, id, name, ''].join('\n');
    // The category goes to the Info.plist and the desktop entry, which the build writes later; any desktop refuses a
    // wrong one here.
    const copyright = appCopyright(config);
    appCategory(config);
    const lines = [
        comment,
        ...page,
        id,
        name,
        ...windowDefines(appWindow(config)),
    ];
    if (platform === 'win32') {
        const version = windowsVersion(config);
        lines.push(`#define CROSSBIND_APP_VERSION "${version.text}"`, `#define CROSSBIND_APP_VERSION_NUMBERS ${version.numbers}`);
        if (copyright) lines.push(`#define CROSSBIND_APP_COPYRIGHT "${copyright}"`);
        // The build writes the icon beside this header.
        if (config.app.icon !== undefined) lines.push('#define CROSSBIND_APP_ICON 1');
    }
    return [...lines, ''].join('\n');
}

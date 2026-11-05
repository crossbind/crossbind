// What opens an app beside its schemes' links: the files of its types, on iOS and Android the https links of its sites
// and the quick actions of its icon, and on iOS and macOS the user activities of its types, each with the extension that
// declared it, whose native code gets them, or null for the app's own, which the host hands the page.

const FILE_TYPE_KEYS = ['name', 'extensions', 'mimeTypes', 'role', 'contentTypes'];
const ROLES = ['editor', 'viewer'];
const EXTENSION = /^[a-z0-9][a-z0-9_+-]*$/;
// Of what an Android manifest's attribute and a C++ string literal hold as they are.
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$^_.+-]*\/[a-z0-9][a-z0-9!#$^_.+-]*$/;
const CONTENT_TYPE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// A domain of two labels at least, the last of letters or punycode, maybe with *. for its subdomains, then maybe the
// path its links start with, of the characters a URL's path takes as they are, but those a manifest's attribute or the
// host's C++ string literal escapes, and %, as Android and the host match a link's decoded path.
const LINK = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]*[a-z0-9])(\/[A-Za-z0-9\-._~!$()+,;=:@/]*)?$/;

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const ownerName = (extension, key) => (extension === null ? `app.${key}` : `the extension ${extension}`);

function checkedList(at, values, pattern, what, isRequired) {
    if (!Array.isArray(values)) throw new Error(`crossbind: ${at} ${JSON.stringify(values)} is no list of ${what}.`);
    if (isRequired && values.length === 0) throw new Error(`crossbind: ${at} lists none, where it takes ${what}.`);
    for (const value of values) {
        if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`crossbind: ${at} takes ${what}; ${JSON.stringify(value)} is none.`);
    }
    return values;
}

// The types of files an app opens: each with its name, which the system shows its files' kind by, the extensions of its
// files, the MIME types Android and Linux match them by, its role, an editor's unless a viewer's, and the uniform type
// identifiers Apple's platforms know a type by that they have of their own, as CSV's.
export function checkedFileTypes(types, where) {
    if (!Array.isArray(types)) {
        throw new Error(`crossbind: ${where} ${JSON.stringify(types)} is no list of file types, as [{ name: 'GeoJSON', extensions: ['geojson'] }] is.`);
    }
    return types.map((type, index) => {
        const at = `${where}[${index}]`;
        if (!isPlainObject(type)) throw new Error(`crossbind: ${at} is no file type, as { name: 'GeoJSON', extensions: ['geojson'] } is.`);
        const unknown = Object.keys(type).filter((key) => !FILE_TYPE_KEYS.includes(key));
        if (unknown.length > 0) throw new Error(`crossbind: ${at} takes ${FILE_TYPE_KEYS.join(', ')}; ${unknown.join(', ')} is none of them.`);
        if (typeof type.name !== 'string' || type.name.trim() === '') throw new Error(`crossbind: ${at} has no name, which the system shows its files' kind by.`);
        // A Linux desktop entry and a Windows setup program hold it on one line.
        if ([...type.name].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) throw new Error(`crossbind: ${at}.name ${JSON.stringify(type.name)} holds a control character, as a line break; name it on one line.`);
        const role = type.role ?? 'editor';
        if (!ROLES.includes(role)) throw new Error(`crossbind: ${at}.role is 'editor' or 'viewer'; ${JSON.stringify(type.role)} is neither.`);
        return {
            name: type.name,
            extensions: checkedList(`${at}.extensions`, type.extensions, EXTENSION, "lowercase letters and digits without the dot, as 'geojson' is", true),
            mimeTypes: checkedList(`${at}.mimeTypes`, type.mimeTypes ?? [], MIME_TYPE, "MIME types, as 'application/geo+json' is", false),
            role,
            contentTypes: checkedList(`${at}.contentTypes`, type.contentTypes ?? [], CONTENT_TYPE, "uniform type identifiers, as 'public.comma-separated-values-text' is", false),
        };
    });
}

// The types of files that open the app, app.fileTypes's, then its extensions', each with the extension that declared it,
// or null. One owner of an extension's files alone: two stop the build, naming both.
export function fileTypeOwners(config) {
    const owned = [
        ...checkedFileTypes(config.app.fileTypes ?? [], 'app.fileTypes').map((type) => ({ ...type, extension: null })),
        ...(config.extensions ?? []).flatMap(({ name, app }) => (app.fileTypes ?? []).map((type) => ({ ...type, extension: name }))),
    ];
    const owners = new Map();
    for (const { extensions, extension } of owned) {
        for (const ending of extensions) {
            if (!owners.has(ending)) {
                owners.set(ending, extension);
            } else if (owners.get(ending) === extension) {
                throw new Error(`crossbind: ${ownerName(extension, 'fileTypes')} lists the files .${ending} twice.`);
            } else {
                throw new Error(`crossbind: ${ownerName(owners.get(ending), 'fileTypes')} and ${ownerName(extension, 'fileTypes')} both claim the files .${ending}, which one alone opens.`);
            }
        }
    }
    return owned;
}

const ROLE_NAMES = { editor: 'Editor', viewer: 'Viewer' };

// A macOS app's document types: each by its extensions, unless its content types name it.
export function macDocumentTypes(fileTypes) {
    return fileTypes.map(({ name, extensions, mimeTypes, role, contentTypes }) => ({
        CFBundleTypeName: name,
        CFBundleTypeRole: ROLE_NAMES[role],
        ...(contentTypes.length > 0 ? { LSItemContentTypes: contentTypes } : { CFBundleTypeExtensions: extensions }),
        ...(mimeTypes.length > 0 ? { CFBundleTypeMIMETypes: mimeTypes } : {}),
    }));
}

// An iOS app's document types, which iOS knows by type identifiers alone: Apple's that a type's content types name, else
// one the app declares from the type's extensions and MIME types, named after its bundle id. The app opens a document
// where it is.
export function iosDocumentTypes(fileTypes, bundleId) {
    if (fileTypes.length === 0) return {};
    // A type identifier takes letters, digits, - and . alone.
    const ownIdentifier = (type) => `${bundleId}.${type.extensions[0].replace(/[^A-Za-z0-9-]/g, '-')}`;
    return {
        CFBundleDocumentTypes: fileTypes.map((type) => ({
            CFBundleTypeName: type.name,
            CFBundleTypeRole: ROLE_NAMES[type.role],
            LSItemContentTypes: type.contentTypes.length > 0 ? type.contentTypes : [ownIdentifier(type)],
        })),
        UTImportedTypeDeclarations: fileTypes.filter((type) => type.contentTypes.length === 0).map((type) => ({
            UTTypeIdentifier: ownIdentifier(type),
            UTTypeDescription: type.name,
            UTTypeConformsTo: ['public.data'],
            UTTypeTagSpecification: {
                'public.filename-extension': type.extensions,
                ...(type.mimeTypes.length > 0 ? { 'public.mime-type': type.mimeTypes } : {}),
            },
        })),
        LSSupportsOpeningDocumentsInPlace: true,
    };
}

// The https links of a list's sites, which open the app on iOS and Android: each a domain, lowercase, maybe with *. for
// its subdomains, then maybe the path its links start with, as example.com/invite is.
export function checkedLinks(links, where) {
    if (!Array.isArray(links)) throw new Error(`crossbind: ${where} ${JSON.stringify(links)} is no list of links, as ['example.com/invite'] is.`);
    for (const link of links) {
        if (typeof link !== 'string' || !LINK.test(link)) {
            const scheme = typeof link === 'string' ? /^(https?):\/\//.exec(link)?.[1] : undefined;
            throw new Error(`crossbind: ${where} takes a site's domain, maybe with *. for its subdomains, then maybe the path its links start with, as example.com/invite is${scheme ? `, without its ${scheme}://` : ''}; ${JSON.stringify(link)} is none.`);
        }
    }
    const twice = links.find((link, index) => links.indexOf(link) !== index);
    if (twice) throw new Error(`crossbind: ${where} lists ${twice} twice.`);
    return links;
}

// The type of a user activity or a quick action: a reverse-DNS name or an intent's class, of what an Info.plist's
// string, an Android resource's attribute and the host's C++ string literal hold as they are.
const TYPE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A web page's activity is a site's link.
const BROWSING_WEB = 'NSUserActivityTypeBrowsingWeb';

// The types of the user activities an iOS or macOS app continues, as Handoff from another of its user's devices does,
// each once.
export function checkedActivityTypes(types, where) {
    checkedList(where, types, TYPE_NAME, "user activity types of letters, digits, ., _ and -, as 'com.example.app.edit' is", false);
    if (types.includes(BROWSING_WEB)) throw new Error(`crossbind: ${where} cannot take ${BROWSING_WEB}, a web page's, which app.links takes by its site.`);
    const twice = types.find((type, index) => types.indexOf(type) !== index);
    if (twice) throw new Error(`crossbind: ${where} lists ${twice} twice.`);
    return types;
}

// The types of the user activities the app continues, app.activityTypes's, then its extensions', each with the extension
// that declared it, or null, whose activities the host's activities hands the page. Two owners of one stop the build,
// naming both.
export function activityTypeOwners(config) {
    const owned = [
        ...checkedActivityTypes(config.app.activityTypes ?? [], 'app.activityTypes').map((type) => ({ type, extension: null })),
        ...(config.extensions ?? []).flatMap(({ name, app }) => (app.activityTypes ?? []).map((type) => ({ type, extension: name }))),
    ];
    owned.forEach(({ type, extension }, index) => {
        const first = owned.findIndex((other) => other.type === type);
        if (first !== index) {
            throw new Error(`crossbind: ${ownerName(owned[first].extension, 'activityTypes')} and ${ownerName(extension, 'activityTypes')} both claim the user activities ${type}, which one alone continues.`);
        }
    });
    return owned;
}

const SHORTCUT_KEYS = ['type', 'title', 'subtitle', 'icon'];
// iOS's own icons of a quick action, UIApplicationShortcutIconType's names without its prefix.
const SHORTCUT_ICONS = [
    'add', 'alarm', 'audio', 'bookmark', 'capturePhoto', 'captureVideo', 'cloud', 'compose', 'confirmation', 'contact', 'date', 'favorite', 'home',
    'invitation', 'location', 'love', 'mail', 'markLocation', 'message', 'pause', 'play', 'prohibit', 'search', 'share', 'shuffle', 'task',
    'taskCompleted', 'time', 'update',
];

// Text the system shows on one line, or null for none where it may have none.
function checkedLine(at, value, isRequired) {
    if (value === undefined && !isRequired) return null;
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`crossbind: ${at} is no text, which the system shows.`);
    // XML holds neither \uFFFE nor \uFFFF.
    if (/[\p{Cc}\uFFFE\uFFFF]/u.test(value)) {
        throw new Error(`crossbind: ${at} ${JSON.stringify(value)} holds a control character, as a line break; give it on one line.`);
    }
    return value;
}

// The quick actions of an iOS or Android app's icon: each by its type, with its title, and on iOS a subtitle and one of
// its own icons, as compose is.
export function checkedShortcutItems(items, where) {
    if (!Array.isArray(items)) throw new Error(`crossbind: ${where} ${JSON.stringify(items)} is no list of quick actions, as [{ type: 'new-note', title: 'New note' }] is.`);
    const checked = items.map((item, index) => {
        const at = `${where}[${index}]`;
        if (!isPlainObject(item)) throw new Error(`crossbind: ${at} is no quick action, as { type: 'new-note', title: 'New note' } is.`);
        const unknown = Object.keys(item).filter((key) => !SHORTCUT_KEYS.includes(key));
        if (unknown.length > 0) throw new Error(`crossbind: ${at} takes ${SHORTCUT_KEYS.join(', ')}; ${unknown.join(', ')} is none of them.`);
        if (typeof item.type !== 'string' || !TYPE_NAME.test(item.type)) {
            throw new Error(`crossbind: ${at}.type takes letters, digits, ., _ and -, as 'new-note' does; ${JSON.stringify(item.type)} is none.`);
        }
        if (item.icon !== undefined && item.icon !== null && !SHORTCUT_ICONS.includes(item.icon)) {
            throw new Error(`crossbind: ${at}.icon is one of iOS's own icons, ${SHORTCUT_ICONS.join(', ')}; ${JSON.stringify(item.icon)} is none.`);
        }
        const subtitle = item.subtitle === null ? null : checkedLine(`${at}.subtitle`, item.subtitle, false);
        return { type: item.type, title: checkedLine(`${at}.title`, item.title, true), subtitle, icon: item.icon ?? null };
    });
    const twice = checked.find(({ type }, index) => checked.findIndex((other) => other.type === type) !== index);
    if (twice) throw new Error(`crossbind: ${where} lists the quick action ${twice.type} twice.`);
    return checked;
}

// The quick actions of the app's icon, app.shortcutItems's, then its extensions', each with the extension that declared
// it, or null, whose taps the host's shortcuts hands the page. Two owners of one type stop the build, naming both.
export function shortcutItemOwners(config) {
    const owned = [
        ...checkedShortcutItems(config.app.shortcutItems ?? [], 'app.shortcutItems').map((item) => ({ ...item, extension: null })),
        ...(config.extensions ?? []).flatMap(({ name, app }) => (app.shortcutItems ?? []).map((item) => ({ ...item, extension: name }))),
    ];
    owned.forEach(({ type, extension }, index) => {
        const first = owned.findIndex((other) => other.type === type);
        if (first !== index) {
            throw new Error(`crossbind: ${ownerName(owned[first].extension, 'shortcutItems')} and ${ownerName(extension, 'shortcutItems')} both claim the quick action ${type}, whose taps one alone gets.`);
        }
    });
    return owned;
}

// An iOS app's quick actions, as its Info.plist lists them.
export const iosShortcutItems = (items) => items.map(({ type, title, subtitle, icon }) => ({
    UIApplicationShortcutItemType: type,
    UIApplicationShortcutItemTitle: title,
    ...(subtitle ? { UIApplicationShortcutItemSubtitle: subtitle } : {}),
    ...(icon ? { UIApplicationShortcutItemIconType: `UIApplicationShortcutIconType${icon[0].toUpperCase()}${icon.slice(1)}` } : {}),
}));

// A link's domain and the path its links start with, empty for all of the site's.
export function appLinkParts(link) {
    const slash = link.indexOf('/');
    return slash < 0 ? { host: link, path: '' } : { host: link.slice(0, slash), path: link.slice(slash) };
}

// The links that open the app, app.links's, then its extensions', each with the extension that declared it, or null,
// whose links the host's links hands the page. Two owners of one stop the build, naming both.
export function linkOwners(config) {
    const owned = [
        ...checkedLinks(config.app.links ?? [], 'app.links').map((link) => ({ link, extension: null })),
        ...(config.extensions ?? []).flatMap(({ name, app }) => (app.links ?? []).map((link) => ({ link, extension: name }))),
    ];
    owned.forEach(({ link, extension }, index) => {
        const first = owned.findIndex((other) => other.link === link);
        if (first !== index) {
            throw new Error(`crossbind: ${ownerName(owned[first].extension, 'links')} and ${ownerName(extension, 'links')} both claim the links of ${link}, which one alone gets.`);
        }
    });
    return owned;
}

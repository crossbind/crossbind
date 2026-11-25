import { PAGE_API_PATH } from './previewSession.js';

// The id under which a preview's page takes crossbind/app and crossbind/app/core, which Vite serves as
// /@id/__x00__crossbind-preview:app.
export const PREVIEW_MODULE_ID = '\0crossbind-preview:app';
const OLDER = "crossbind: the crossbind app on this device is older than this project's crossbind: update the app to use ";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// What a preview refuses of crossbind/app: every member of these names, and these members of the others.
const REFUSED_WHOLE = ['app', 'windows', 'menu', 'tray', 'updater', 'notification'];
const REFUSED_MEMBERS = { shell: ['openPath', 'revealInFolder', 'trash'], dialog: ['open', 'save'] };
const ENDING = ['app.quit', 'app.requestQuit', 'app.relaunch'];
const PICKING = ['dialog.open', 'dialog.save'];

const isObject = (value) => value !== null && typeof value === 'object';

// The words a preview refuses a function of crossbind/app with: one that would end the preview, and one that belongs to
// the built app, as a window, a menu, a notification or a folder of its own, which crossbind app dev runs.
export function previewRefusal(name) {
    if (ENDING.includes(name)) return `crossbind: in a preview, ${name} would end the preview; close it from its menu.`;
    const instead = PICKING.includes(name) ? 'pick files with a file input, or try it with crossbind app dev' : 'try it with crossbind app dev';
    return `crossbind: in a preview, ${name} belongs to the built app; ${instead}.`;
}

// The module of the project's side: every name of the project's own crossbind/app, each the app's own value from the
// page API it answers at PAGE_API_PATH; for a name or a member the app lacks, a stand-in whose call rejects saying
// which, and whose members are such stand-ins, so the rest of the page runs; and for what a preview refuses, a
// stand-in whose call rejects in its words. api is the project's crossbind/app as Node imports it.
export function previewModuleSource(api) {
    const names = Object.keys(api).sort();
    const odd = names.find((name) => !IDENTIFIER.test(name) || name === 'default');
    if (odd !== undefined) throw new Error(`crossbind: this project's crossbind/app exports ${JSON.stringify(odd)}, which a preview cannot pass on: update @crossbind/core-app-host to match crossbind.`);
    return [
        `import * as api from ${JSON.stringify(PAGE_API_PATH)};`,
        `const OLDER = ${JSON.stringify(OLDER)};`,
        `const ENDING = ${JSON.stringify(ENDING)};`,
        `const PICKING = ${JSON.stringify(PICKING)};`,
        `const previewRefusal = ${previewRefusal.toString()};`,
        "const stub = (fail, name, member) => new Proxy(fail, { get: (target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : member(`${name}.${key}`)) });",
        'function lacking(name) {',
        '    return stub(async () => { throw new Error(OLDER + name); }, name, lacking);',
        '}',
        'function refused(name) {',
        '    return stub(async () => { throw new Error(previewRefusal(name)); }, name, refused);',
        '}',
        'function withMembers(value, name, members, refusing) {',
        "    if (value === null || typeof value !== 'object') return value;",
        '    return new Proxy(value, {',
        "        get: (target, key, receiver) => (typeof key === 'symbol' ? Reflect.get(target, key, receiver)",
        '            : refusing.includes(key) ? refused(`${name}.${key}`)',
        '                : key in target || !members.includes(key) ? Reflect.get(target, key, receiver) : lacking(`${name}.${key}`)),',
        '    });',
        '}',
        ...names.map((name) => {
            if (REFUSED_WHOLE.includes(name)) return `export const ${name} = refused('${name}');`;
            const refusing = JSON.stringify(REFUSED_MEMBERS[name] ?? []);
            const value = isObject(api[name]) ? `withMembers(api.${name}, '${name}', ${JSON.stringify(Object.keys(api[name]))}, ${refusing})` : `api.${name}`;
            return `export const ${name} = '${name}' in api ? ${value} : lacking('${name}');`;
        }),
        '',
    ].join('\n');
}

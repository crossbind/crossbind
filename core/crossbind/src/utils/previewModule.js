import { PAGE_API_PATH } from './previewSession.js';

// The id under which a preview's page takes crossbind/app and crossbind/app/core, which Vite serves as
// /@id/__x00__crossbind-preview:app.
export const PREVIEW_MODULE_ID = '\0crossbind-preview:app';
const OLDER = "crossbind: the crossbind app on this device is older than this project's crossbind: update the app to use ";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const isObject = (value) => value !== null && typeof value === 'object';

// The module of the project's side: every name of the project's own crossbind/app, each the app's own value from the
// page API it answers at PAGE_API_PATH; for a name or a member the app lacks, a stand-in whose call rejects saying
// which, and whose members are such stand-ins, so the rest of the page runs. api is the project's crossbind/app as
// Node imports it.
export function previewModuleSource(api) {
    const names = Object.keys(api).sort();
    const odd = names.find((name) => !IDENTIFIER.test(name) || name === 'default');
    if (odd !== undefined) throw new Error(`crossbind: this project's crossbind/app exports ${JSON.stringify(odd)}, which a preview cannot pass on: update @crossbind/core-app-host to match crossbind.`);
    return [
        `import * as api from ${JSON.stringify(PAGE_API_PATH)};`,
        `const OLDER = ${JSON.stringify(OLDER)};`,
        'function lacking(name) {',
        '    const fail = async () => { throw new Error(OLDER + name); };',
        "    return new Proxy(fail, { get: (target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : lacking(`${name}.${key}`)) });",
        '}',
        'function withMembers(value, name, members) {',
        "    if (value === null || typeof value !== 'object') return value;",
        '    return new Proxy(value, {',
        "        get: (target, key, receiver) => (typeof key === 'symbol' || key in target || !members.includes(key) ? Reflect.get(target, key, receiver) : lacking(`${name}.${key}`)),",
        '    });',
        '}',
        ...names.map((name) => {
            const value = isObject(api[name]) ? `withMembers(api.${name}, '${name}', ${JSON.stringify(Object.keys(api[name]))})` : `api.${name}`;
            return `export const ${name} = '${name}' in api ? ${value} : lacking('${name}');`;
        }),
        '',
    ].join('\n');
}

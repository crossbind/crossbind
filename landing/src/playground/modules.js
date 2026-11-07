// main.js runs in the sandbox as a module whose native imports resolve to modules made from the build's import list
// (browser/imports.json from `crossbind build --bind-imports`), as Node's import hooks serve them
// (core/crossbind/src/assets/node-import-hooks.mjs): one module holding every bound name, one per imported file
// re-exporting its names. A module names another as `<token>:<index>`, which the sandbox replaces with that module's
// blob URL; the token is random per run, so no text the visitor wrote matches it.

// The imports crossbind's own scan finds (core/crossbind/src/utils/nativeImports.js), written so a run of spaces costs
// linear time. Only those it binds (NATIVE) are mapped; the rest are left for the browser to resolve, so a string that
// merely reads like an import is no error.
const IMPORT = /(\b(?:from|import(?:\s*\()?|require\s*\()\s*)(['"])([^'"\n]+)\2/g;
const NATIVE = /^(?:cargo|conan):|\.(?:h|hh|hpp|hxx|rs)$/;
// The names go into the modules' code; a compile's list is checked on the server, a prebuilt one here.
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// main.js is src/main.js in the project the compiler builds; the list names files from the project's root.
const MAIN_DIR = 'src';
// Where the sandbox puts the booted module for the first module to read (public/playground/sandbox.html).
const NATIVE_KEY = 'crossbind.playground.native';

export class ImportError extends Error {}

export const importSpecifiers = (code) => [...new Set([...code.matchAll(IMPORT)].map((match) => match[3]))];

const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../');

function resolveFromMain(specifier) {
    const parts = [MAIN_DIR];
    specifier.split('/').forEach((part) => {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
    });
    return parts.join('/');
}

const wireOf = (name) => (typeof name === 'string' ? name : name.wire);
const exportOf = (name) => (typeof name === 'string' ? name : `${name.wire} as ${name.local}`);
const isName = (name) => (typeof name === 'string' ? IDENTIFIER.test(name) : IDENTIFIER.test(name?.local) && IDENTIFIER.test(name?.wire));

// The modules the sandbox makes, main.js last, after the project's other scripts, which go in as they are. Throws an
// ImportError naming every import of a native file or a script the project cannot serve.
export function prepareModules({ code, imports, token, scripts = {} }) {
    const natives = imports?.natives ?? [];
    if (!natives.every(({ names }) => Array.isArray(names) && names.every(isName))) {
        throw new ImportError('The module came with an import list this page cannot read.');
    }
    const wires = [...new Set(natives.flatMap(({ names }) => names.map(wireOf)))];
    const entry = [
        `const native = globalThis[Symbol.for(${JSON.stringify(NATIVE_KEY)})];`,
        'export const initNative = () => Promise.resolve(native);',
        'export { native as AllSymbols };',
        ...wires.map((wire, i) => `const $${i} = native[${JSON.stringify(wire)}];`),
        ...(wires.length ? [`export { ${wires.map((wire, i) => `$${i} as ${wire}`).join(', ')} };`] : []),
    ].join('\n');
    const proxies = natives.map(({ names }) => `export { ${['initNative', 'AllSymbols', ...names.map(exportOf)].join(', ')} } from '${token}:0';`);

    const byFile = new Map(natives.map(({ file }, index) => [file, index + 1]));
    const byScript = new Map(Object.keys(scripts).map((name, index) => [resolveFromMain(`./${name}`), proxies.length + 1 + index]));
    const bySpecifier = new Map(natives.flatMap(({ specifiers }, index) => specifiers.map((specifier) => [specifier, index + 1])));
    const unknown = new Set();
    const main = code.replace(IMPORT, (match, before, quote, specifier) => {
        const file = isRelative(specifier) ? resolveFromMain(specifier) : null;
        const index = file ? byFile.get(file) ?? byScript.get(file) : bySpecifier.get(specifier);
        if (index === undefined) {
            if (NATIVE.test(specifier) || (file && specifier.endsWith('.js'))) unknown.add(specifier);
            return match;
        }
        return `${before}${quote}${token}:${index}${quote}`;
    });
    if (unknown.size) {
        const names = [...unknown].map((specifier) => `'${specifier}'`).join(', ');
        throw new ImportError(`main.js imports ${names}, which this project does not provide: main.js can import its files under native/, its other scripts and its packages.`);
    }
    return [entry, ...proxies, ...Object.values(scripts), main];
}

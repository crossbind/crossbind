// Node's module hooks for the native imports one crossbind build bound, so a Node app imports a header, a
// conan: header or a package's header the way a bundler plugin lets it. Each resolves to a module that
// re-exports its names from the runtime entry, which initNative() fills. Copied into dist by the build.
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isBare = (specifier) => !/^(\.{1,2}\/|\/|[A-Za-z]:[\\/]|file:)/.test(specifier);

function notBound(what, parentURL, cause) {
    const from = parentURL ? `, imported from ${parentURL},` : '';
    return new Error(`crossbind: ${what}${from} is not bound by the last crossbind build. Build again after adding a native import, or start Node with --import crossbind/node/dev to build whenever one is added; an import specifier computed at run time is not found by the build.`, { cause });
}

const exportOf = (name) => (typeof name === 'string' ? name : `${name.wire} as ${name.local}`);
const proxyOf = (entry, names) => `export { ${['initNative', 'AllSymbols', ...names.map(exportOf)].join(', ')} } from ${JSON.stringify(entry)};\n`;

// Another hook may still serve it; Node's own resolver hands an unknown scheme on unresolved.
function resolveUnbound(specifier, context, nextResolve, scheme) {
    let resolved;
    try {
        resolved = nextResolve(specifier, context);
    } catch (error) {
        throw notBound(specifier, context.parentURL, error);
    }
    if (scheme.test(resolved.url)) throw notBound(specifier, context.parentURL);
    return resolved;
}

// `natives` lists each bound file, relative to the entry, with the bare specifiers that name it and the names it
// exports, a name the entry exports under another as { local, wire }. `schemes` are those an import names a store
// by: the two every build has, for a register file an older build wrote, which names none.
export default function registerNativeImports(entry, { extensions, schemes = ['cargo', 'conan'], natives }) {
    const entryUrl = new URL(entry).href;
    const dir = path.dirname(fileURLToPath(entryUrl));
    const isNative = new RegExp(`\\.(${extensions.join('|')})$`);
    const scheme = new RegExp(`^(${schemes.join('|')}):`);
    const byFile = new Map();
    const bySpecifier = new Map();
    natives.forEach(({ file, specifiers, names }) => {
        const absolute = path.resolve(dir, file);
        byFile.set(absolute, names);
        specifiers.forEach((specifier) => bySpecifier.set(specifier, pathToFileURL(absolute).href));
    });

    registerHooks({
        resolve(specifier, context, nextResolve) {
            const url = bySpecifier.get(specifier);
            if (url) return { url, format: 'module', shortCircuit: true };
            if (isBare(specifier) && (scheme.test(specifier) || isNative.test(specifier))) return resolveUnbound(specifier, context, nextResolve, scheme);
            return nextResolve(specifier, context);
        },
        load(url, context, nextLoad) {
            if (!url.startsWith('file:')) return nextLoad(url, context);
            const file = fileURLToPath(url);
            const names = byFile.get(file);
            if (names) return { format: 'module', source: proxyOf(entryUrl, names), shortCircuit: true };
            if (isNative.test(file)) throw notBound(file);
            return nextLoad(url, context);
        },
    });
}

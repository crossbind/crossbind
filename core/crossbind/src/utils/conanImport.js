import fs from 'node:fs';

export const CONAN_PREFIX = 'conan:';
// Conan 2 refuses upper-case package names.
export const CONAN_NAME = /^[a-z0-9_][a-z0-9_+.-]*$/;
// No leading dot, so neither '.' nor '..' can climb out of the include directory.
const HEADER_SEGMENT = /^[A-Za-z0-9_+-][A-Za-z0-9_.+-]*$/;

export const conanStageDir = (cacheDir) => `${cacheDir}/conan`;
// Apart from the stage's own files, so no package name can land on one of them.
export const conanPackageDir = (stageDir, name) => `${stageDir}/packages/${name}`;

export function parseConanImport(source, headerExtensions) {
    const [name, ...headerPath] = source.slice(CONAN_PREFIX.length).split('/');
    if (!CONAN_NAME.test(name)) {
        throw new Error(`crossbind: '${source}' - '${name}' is not a Conan package name; write conan:<package>/<header>, such as conan:zlib/zlib.h.`);
    }
    if (headerPath.length === 0) {
        throw new Error(`crossbind: '${source}' names no header - import one of the package's headers as conan:${name}/<header>.`);
    }
    const bad = headerPath.find((segment) => !HEADER_SEGMENT.test(segment));
    if (bad !== undefined) {
        throw new Error(`crossbind: '${source}' - '${bad}' is not a header path segment.`);
    }
    const header = headerPath.join('/');
    const extension = header.includes('.') ? header.split('.').at(-1) : '';
    if (!headerExtensions.includes(extension)) {
        throw new Error(`crossbind: '${source}' - a conan: import names a header (${headerExtensions.map((e) => `.${e}`).join(', ')}).`);
    }
    return { name, header };
}

// The inverse of resolveConanHeader, for the editor types of a staged header.
export function conanImportOfHeader(file, cacheDir) {
    const prefix = conanPackageDir(conanStageDir(cacheDir), '');
    if (!file.startsWith(prefix)) return null;
    const match = file.slice(prefix.length).match(/^([^/]+)\/dist\/prebuilt\/[^/]+\/include\/(.+)$/);
    // Both end up in the module name of the generated types.
    if (!match || !CONAN_NAME.test(match[1]) || !match[2].split('/').every((segment) => HEADER_SEGMENT.test(segment))) return null;
    return { name: match[1], header: match[2] };
}

// Only declared packages are importable, as with cargo:; a package pulled in by another links but stays hidden.
export function resolveConanHeader(config, source, target) {
    const { name, header } = parseConanImport(source, config.ext.header);
    if (!Object.hasOwn(config.conanDependencies ?? {}, name)) {
        throw new Error(`crossbind: '${source}' is not declared - add '${name}' to conanDependencies in crossbind.config.`);
    }
    const dependency = config.allDependencies.find((d) => d.general.conan?.name === name);
    if (!dependency) {
        throw new Error(`crossbind: '${source}' - ${name} is declared in conanDependencies but not installed; crossbind installs Conan packages when a build starts.`);
    }
    const tried = [...new Set([target.releasePath, target.path].filter(Boolean))]
        .map((targetPath) => `${dependency.paths.output}/prebuilt/${targetPath}/include/${header}`);
    const found = tried.find((file) => fs.existsSync(file));
    if (found) return found;
    throw new Error(`crossbind: '${source}' - ${name} has no ${header}. Tried:\n${tried.map((file) => `  - ${file}`).join('\n')}`);
}

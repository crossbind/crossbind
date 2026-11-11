import fs from 'node:fs';

// A package of a source, as an import and a folder name it. Lower-case, as Conan's are: a file system that
// ignores case holds one folder for two names that differ in case alone.
export const PACKAGE_NAME = /^[a-z0-9_][a-z0-9_+.-]*$/;
// No leading dot, so neither '.' nor '..' can climb out of the include directory.
const HEADER_SEGMENT = /^[A-Za-z0-9_+-][A-Za-z0-9_.+-]*$/;

export const sourceStageDir = (cacheDir, source) => `${cacheDir}/${source}`;
// Apart from the stage's own files, so no package name can land on one of them.
export const sourcePackageDir = (stageDir, name) => `${stageDir}/packages/${name}`;

// A source's name is its scheme and names all that is its own: packages.<name> in the config, <name>.lock and
// .crossbind/<name>. Where a project declares its packages, as a message names it, and what it declares there.
export const declarationOf = (source) => `packages.${source}`;
export const dependenciesOf = (config, source) => config.packages?.[source] ?? {};

// The source whose scheme a specifier opens with, as conan:zlib/zlib.h names conan.
export const sourceOfImport = (config, specifier) => (config.packageSources ?? []).find(({ name }) => specifier.startsWith(`${name}:`));

export function parseSourceImport(source, specifier, headerExtensions) {
    const [name, ...headerPath] = specifier.slice(source.length + 1).split('/');
    if (!PACKAGE_NAME.test(name)) {
        throw new Error(`crossbind: '${specifier}' - '${name}' is not a ${source} package name; write ${source}:<package>/<header>.`);
    }
    if (headerPath.length === 0) {
        throw new Error(`crossbind: '${specifier}' names no header - import one of the package's headers as ${source}:${name}/<header>.`);
    }
    const bad = headerPath.find((segment) => !HEADER_SEGMENT.test(segment));
    if (bad !== undefined) {
        throw new Error(`crossbind: '${specifier}' - '${bad}' is not a header path segment.`);
    }
    const header = headerPath.join('/');
    const extension = header.includes('.') ? header.split('.').at(-1) : '';
    if (!headerExtensions.includes(extension)) {
        throw new Error(`crossbind: '${specifier}' - a ${source}: import names a header (${headerExtensions.map((e) => `.${e}`).join(', ')}).`);
    }
    return { name, header };
}

// The inverse of resolveSourceHeader, for the editor types of a staged header.
export function sourceImportOfHeader(file, cacheDir, sources) {
    const prefixOf = (source) => sourcePackageDir(sourceStageDir(cacheDir, source), '');
    const source = sources.find((name) => file.startsWith(prefixOf(name)));
    if (!source) return null;
    const match = file.slice(prefixOf(source).length).match(/^([^/]+)\/dist\/prebuilt\/[^/]+\/include\/(.+)$/);
    // Both end up in the module name of the generated types.
    if (!match || !PACKAGE_NAME.test(match[1]) || !match[2].split('/').every((segment) => HEADER_SEGMENT.test(segment))) return null;
    return { source, name: match[1], header: match[2] };
}

// Only declared packages are importable, as with cargo:; a package pulled in by another links but stays hidden.
export function resolveSourceHeader(config, source, specifier, target) {
    const { name, header } = parseSourceImport(source, specifier, config.ext.header);
    if (!Object.hasOwn(dependenciesOf(config, source), name)) {
        throw new Error(`crossbind: '${specifier}' is not declared - add '${name}' to ${declarationOf(source)} in crossbind.config.`);
    }
    const dependency = config.allDependencies.find(({ general }) => general.packageSource?.name === source && general.packageSource.package.name === name);
    if (!dependency) {
        throw new Error(`crossbind: '${specifier}' - ${name} is declared in ${declarationOf(source)} but not installed; crossbind installs ${source} packages when a build starts.`);
    }
    const tried = [...new Set([target.releasePath, target.path].filter(Boolean))]
        .map((targetPath) => `${dependency.paths.output}/prebuilt/${targetPath}/include/${header}`);
    const found = tried.find((file) => fs.existsSync(file));
    if (found) return found;
    throw new Error(`crossbind: '${specifier}' - ${name} has no ${header}. Tried:\n${tried.map((file) => `  - ${file}`).join('\n')}`);
}

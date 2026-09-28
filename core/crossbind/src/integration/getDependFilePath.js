import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import { parseCargoImport, writeCargoMarker } from '../utils/cargoImport.js';

const LAYOUT = { header: 'include', module: 'swig', source: '' };

let extRegexCache = { key: null, header: null, module: null };
function getExtRegex() {
    const { header, module } = state.config.ext;
    const key = `${header.join(',')}|${module.join(',')}`;
    if (extRegexCache.key !== key) {
        extRegexCache = {
            key,
            header: new RegExp(`\\.(${header.join('|')})$`),
            module: new RegExp(`\\.(${module.join('|')})$`),
        };
    }
    return extRegexCache;
}

const existsCache = new Map();
function existsCached(p) {
    if (existsCache.has(p)) return existsCache.get(p);
    const result = fs.existsSync(p);
    existsCache.set(p, result);
    return result;
}

function getAlias(pkg) {
    const a = pkg.general.alias;
    if (!a) return null;
    if (typeof a !== 'object' || !a.package) {
        throw new Error(
            `Invalid alias for package "${pkg.package.name}": expected { package, lib? }.`,
        );
    }
    return {
        package: a.package,
        lib: a.lib ?? a.package.replace(/[^a-zA-Z0-9]/g, ''),
    };
}

function getMatchingPackages(source) {
    const matches = [];
    for (const pkg of state.config.allDependencies) {
        const alias = getAlias(pkg);
        const prefixes = [pkg.package.name];
        if (alias) prefixes.push(alias.package);

        for (const prefix of prefixes) {
            if (source === prefix || source.startsWith(`${prefix}/`)) {
                matches.push({
                    pkg,
                    alias,
                    relativePath: source.slice(prefix.length + 1),
                });
                break;
            }
        }
    }
    return matches;
}

function getLayoutSubdir(source) {
    const ext = getExtRegex();
    if (ext.header.test(source)) return LAYOUT.header;
    if (ext.module.test(source)) return LAYOUT.module;
    return LAYOUT.source;
}

function getFolderCandidates(pkg, alias) {
    const candidates = [];
    if (alias) candidates.push(alias.lib);
    candidates.push(pkg.general.name, pkg.package.name, '');
    return [...new Set(candidates)];
}

export default function getDependFilePath(source, target) {
    // `cargo:<crate>[/<module>...]` imports (the node:/npm: convention for a non-npm store)
    // resolve to a generated marker .rs; the transformer turns it into the crate-import bridge
    // (no surface file, no package). The scheme is unambiguous, so npm names never collide and
    // an undeclared crate is a hard, actionable error instead of a silent npm fallthrough.
    if (source.startsWith('cargo:')) {
        const cargoImport = parseCargoImport(source);
        const cargoDeps = state.config.cargoDependencies ?? {};
        if (!Object.hasOwn(cargoDeps, cargoImport.crateName)) {
            throw new Error(`crossbind: '${source}' is not declared - add '${cargoImport.crateName}' to cargoDependencies in crossbind.config.`);
        }
        const marker = writeCargoMarker(state.config.paths.cache, cargoImport);
        existsCache.set(marker, true);
        return marker;
    }

    const matches = getMatchingPackages(source);
    if (matches.length === 0) return null;

    const subdir = getLayoutSubdir(source);
    const tried = [];

    for (const { pkg, alias, relativePath } of matches) {
        // A cargo package's bare import resolves to its crate root source; the bundler
        // transformer then turns that .rs into the generated JS proxy module (Rust's .h analog).
        if (pkg.export?.type === 'cargo' && relativePath === '') {
            const libRs = path.resolve(pkg.paths.project, pkg.export.crate ?? 'crate', 'src/lib.rs');
            if (existsCached(libRs)) return libRs;
        }
        const prebuiltRoot = `${pkg.paths.output}/prebuilt/${target.path}`;
        // Skip packages that don't produce artifacts for this target — multiple
        // packages may share the same alias (one per platform), so this filters
        // out the wrong-platform matches without needing explicit metadata.
        if (!existsCached(prebuiltRoot)) continue;

        const baseDir = subdir ? `${prebuiltRoot}/${subdir}` : prebuiltRoot;
        for (const candidate of getFolderCandidates(pkg, alias)) {
            const fullPath = candidate
                ? `${baseDir}/${candidate}/${relativePath}`
                : `${baseDir}/${relativePath}`;
            tried.push(fullPath);
            if (existsCached(fullPath)) return fullPath;
        }
    }

    const matchNames = matches.map((m) => m.pkg.package.name).join(', ');
    throw new Error(
        `Could not resolve "${source}" in package(s) [${matchNames}] for target "${target.path}". Tried:\n`
        + tried.map((t) => `  - ${t}`).join('\n'),
    );
}

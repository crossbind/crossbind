import fs from 'node:fs';
import getDependLibs from './getDependLibs.js';
import state from '../state/index.js';
import buildAppRustCrates from '../utils/appRustCrates.js';

// The archives of a final link (wasm, Node-API addon or native executable) and which of them must
// survive whole. keepFlag spells "keep this symbol" for the target's linker; a native executable
// binds nothing, so it links no bridge.
export default function getLinkInputs(target, { keepFlag, withBridge = true }) {
    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const { build, output, cache } = state.config.paths;
    const { name } = state.config.general;

    // buildLib's cache is keyed on paths.output/prebuilt; after a cache clean the
    // build-dir copy can be gone while the output artifact is still valid — link it then.
    const sourceLibCandidates = [
        `${build}/Source-${buildType}/${target.path}/lib${name}.a`,
        `${output}/prebuilt/${target.path}/lib/lib${name}.a`,
    ];
    // App-local Rust surfaces (imported .rs files) arrive as ONE super staticlib; it is the
    // single fully-loaded Rust archive of the link (see the libstd rule below).
    const appRustLibs = buildAppRustCrates(target, cache, state.config.cargoDependencies ?? {});
    const libs = [
        ...getDependLibs(target),
        ...appRustLibs,
        sourceLibCandidates.find((lib) => fs.existsSync(lib)) ?? sourceLibCandidates[0],
        ...(withBridge ? [`${build}/Bridge-${buildType}/${target.path}/lib${name}.a`] : []),
    ];

    // By default only the Bridge archive is kept whole (see linkLayout.js) so the linker
    // dead-code-eliminates everything unreferenced. Two escape hatches, both
    // `export.wholeArchive: true`: on the APP it restores the legacy layout (every archive
    // wholesale); on a LIBRARY's own config it keeps that library's archives whole in every
    // consumer link (for members that self-register from static initializers).
    const wholeArchiveAll = state.config.export.wholeArchive === true;
    const wholeArchiveNames = new Set();
    // Rust libstd rule: every Rust staticlib bundles its own libstd, so at most ONE Rust archive
    // may be fully loaded (the app super staticlib). Generated cargo bridges are linked lazily
    // with their keep symbol pinned (keepFlag pulls just the registration object); manual-bindings
    // crates have no keep symbol and fall back to whole-archive - safe only while they are the
    // single loaded Rust archive.
    const rustKeepFlags = [];
    if (appRustLibs.length > 0) wholeArchiveNames.add('crossbind_app_super');
    const depends = state.config.dependencyParameters.getCmakeDepends(target);
    depends.forEach((dep) => {
        if (dep.export.wholeArchive === true) {
            (dep.export.libName || []).forEach((libName) => wholeArchiveNames.add(libName));
        }
        if (dep.export.type === 'cargo') {
            const crateLibRs = `${dep.paths.project}/${dep.export.crate ?? 'crate'}/src/lib.rs`.replace('/./', '/');
            const isManual = fs.existsSync(crateLibRs) && fs.readFileSync(crateLibRs, 'utf8').includes('bindings!');
            (dep.export.libName || []).forEach((libName) => {
                if (isManual) wholeArchiveNames.add(libName);
                else rustKeepFlags.push(keepFlag(libName));
            });
        }
    });

    const hasRust = rustKeepFlags.length > 0 || appRustLibs.length > 0
        || depends.some((dep) => dep.export.type === 'cargo');
    return {
        libs, appRustLibs, wholeArchiveAll, wholeArchiveNames, rustKeepFlags, hasRust,
    };
}

import fs from 'node:fs';
import createLib from './createLib.js';
import { isNativeSourceNewerThan } from './isSourceNewer.js';
import createXCFramework from './createXCFramework.js';
import { getBuildTargets, getFilteredTargetSpec } from './target.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import findFiles from '../utils/findFiles.js';

export default function buildLib(targetParams, options = {}) {
    let isChanged = false;
    const targets = getBuildTargets(targetParams);
    if (targets.length === 0) {
        console.error('No targets found for the given parameters.', targetParams);
        throw new Error('No targets found for the given parameters.');
    }

    targets.forEach((target) => {
        // Cargo re-enters the build unconditionally: cargo is the incremental cache, and the
        // existence-only skip below would keep serving a stale staged staticlib after source edits.
        const isCargo = state.config.export?.type === 'cargo';
        if (isCargo || !fs.existsSync(`${state.config.paths.output}/prebuilt/${target.path}/lib`)) {
            createLib(target, 'Source', { buildSource: true });

            const modules = [];
            state.config.paths.module.forEach((modulePath) => {
                modules.push(...findFiles('**/*.i', { cwd: modulePath }));
                modules.push(...findFiles('*.i', { cwd: modulePath }));
            });
            if (modules.length > 0) {
                fs.mkdirSync(`${state.config.paths.output}/prebuilt/${target.path}/swig`, { recursive: true });
            }
            modules.forEach((modulePath) => {
                const fileName = modulePath.split('/').at(-1);
                fs.copyFileSync(modulePath, `${state.config.paths.output}/prebuilt/${target.path}/swig/${fileName}`);
            });
            isChanged = true;
        } else {
            // The skip is existence-only; without this warning a source edit is served stale silently.
            if (isNativeSourceNewerThan(`${state.config.paths.output}/prebuilt/${target.path}/lib`)) {
                logger.info(`[${target.path}] lib cached but native sources are newer - delete the prebuilt output (rm -rf dist .crossbind) and rebuild to pick them up`);
            }
            logger.cachedStep(target, 'lib');
        }
    });

    if (isChanged && fs.existsSync(`${state.config.paths.build}/Source-Release/prebuilt`)) {
        fs.cpSync(`${state.config.paths.build}/Source-Release/prebuilt`, `${state.config.paths.output}/prebuilt`, { recursive: true, dereference: true });
    }
    if (isChanged && fs.existsSync(`${state.config.paths.build}/Source-Debug/prebuilt`)) {
        fs.cpSync(`${state.config.paths.build}/Source-Debug/prebuilt`, `${state.config.paths.output}/prebuilt`, { recursive: true, dereference: true });
    }

    if (!options.skipXcframework) {
        createXCFramework();

        const iosTargets = getBuildTargets({ platform: ['ios'], arch: ['iphoneos'], runtime: ['mt'], buildType: ['release'] });
        const podSpecs = findFiles('*.podspec', { cwd: state.config.paths.project });
        if (podSpecs.length === 0 && targets.length > 0) {
            const iosTarget = iosTargets[0];
            const resources = getFilteredTargetSpec(state.config.targetSpecs, iosTarget).map(s => s.data).filter(s => s).map(d => Object.keys(d)).flat();
            const uniqueResources = [...new Set(resources)].map(r => `dist/prebuilt/${iosTarget.path}/${r}`);
            const xcFrameworks = [];
            xcFrameworks.push(...state.config.export.libName.map((l) => `${l}.xcframework`));
            if (!xcFrameworks.some(f => !fs.existsSync(`${state.config.paths.project}/${f}`))) {
                xcFrameworks.push(...state.config.dependencies.map((d) => d.export.libName.map((l) => `${l}.xcframework`)).flat());
                // Cargo producers register through an init-array constructor that nothing references,
                // so the linker would dead-strip it. Generated bridges pin their keep symbol with -u
                // (NEVER force_load: every Rust staticlib bundles libstd, and fully loading two of
                // them duplicates thousands of std symbols); manual-bindings crates have no keep
                // symbol and fall back to force_load - safe only while they are the single loaded
                // Rust archive in the app.
                let ldFlags = '';
                if (state.config.export?.type === 'cargo') {
                    const crateLibRs = `${state.config.paths.project}/${state.config.export.crate ?? 'crate'}/src/lib.rs`.replace('/./', '/');
                    const isManual = fs.existsSync(crateLibRs) && fs.readFileSync(crateLibRs, 'utf8').includes('bindings!');
                    const flags = state.config.export.libName.map((l) => (isManual
                        ? `-force_load $(PODS_XCFRAMEWORKS_BUILD_DIR)/${state.config.general.name}/lib${l}.a`
                        : `-Wl,-u,_crossbind_keep_${l}`)).join(' ');
                    ldFlags = `, 'OTHER_LDFLAGS' => '${flags}'`;
                }
                const distPodSpecContent = fs.readFileSync(`${state.config.paths.cli}/assets/packaging/crossbind-port.podspec`, { encoding: 'utf8', flag: 'r' })
                    // module_name must be a valid C99 identifier (pod names may carry dashes).
                    .replace('___PROJECT_MODULE_NAME___', state.config.general.name.replace(/[^a-zA-Z0-9_]/g, '_'))
                    .replaceAll('___PROJECT_NAME___', state.config.general.name)
                    .replace('___PROJECT_FRAMEWORKS___', xcFrameworks.map(f => `'${f}'`).join(', '))
                    .replace('___PROJECT_RESOURCES___', JSON.stringify(uniqueResources))
                    .replace('___PROJECT_LDFLAGS___', ldFlags);
                fs.writeFileSync(`${state.config.paths.project}/${state.config.general.name}.podspec`, distPodSpecContent);
            }
        }
    }

    if (fs.existsSync(`${state.config.paths.output}/prebuilt`)) {
        // A partial build (e.g. `crossbind build -p wasm`) must not clobber the other platforms'
        // entries: consumers resolve this CMakeLists for ios/android too, and a target missing
        // from the list silently drops the dependency's include dirs and libs. Advertise every
        // target already present in dist alongside the ones just built.
        const distTargets = fs.readdirSync(`${state.config.paths.output}/prebuilt`, { withFileTypes: true })
            .filter((e) => e.isDirectory() && fs.existsSync(`${state.config.paths.output}/prebuilt/${e.name}/lib`))
            .map((e) => e.name);
        const hostTargets = [...new Set([...distTargets, ...targets.map((t) => t.path)])];
        const distCmakeContent = fs.readFileSync(`${state.config.paths.cli}/assets/cmake/dist.cmake`, { encoding: 'utf8', flag: 'r' })
            .replace('___PROJECT_NAME___', state.config.general.name)
            .replace('___PROJECT_HOST___', hostTargets.join(';'))
            .replace('___PROJECT_LIBS___', state.config.export.libName.join(';'))
            .replace('___PROJECT_WHOLE_ARCHIVE___', (() => {
                if (state.config.export?.type !== 'cargo') return '';
                const crateLibRs = `${state.config.paths.project}/${state.config.export.crate ?? 'crate'}/src/lib.rs`.replace('/./', '/');
                const isManual = fs.existsSync(crateLibRs) && fs.readFileSync(crateLibRs, 'utf8').includes('bindings!');
                return isManual ? 'FORCE' : 'KEEP';
            })());
        fs.writeFileSync(`${state.config.paths.output}/prebuilt/CMakeLists.txt`, distCmakeContent);
    }
}

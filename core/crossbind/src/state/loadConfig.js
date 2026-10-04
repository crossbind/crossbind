import os from 'node:os';
import fs from 'node:fs';
import systemKeys from '../utils/systemKeys.js';
import loadJs from '../utils/loadJs.js';
import {
    resolveDependencyOverride, resolveDependencyReplace, restampIdentity, resolveExcludedNames, getOverrideKey,
} from '../utils/overrideDependency.js';
import loadJson from '../utils/loadJson.js';
import getParentPath from '../utils/getParentPath.js';
import getAbsolutePath from '../utils/getAbsolutePath.js';
import fixPackageName from '../utils/fixPackageName.js';
import getCMakeListsFilePath from '../utils/getCMakeListsFilePath.js';
import calculateDependencyParameters from './calculateDependencyParameters.js';
import logger from '../utils/logger.js';
import { RUNTIME_ENVS } from '../utils/targets.js';
import { normalizeConanDependencies } from '../utils/conanDependencies.js';
// import getCmakeParameters from './getCmakeParameters.js';

// For the project being built only: dependency builds load published configs that may still set
// export.bundle.
export function assertBinarySelection(config) {
    if ('bundle' in config.export) {
        throw new Error('crossbind: export.bundle was removed. A build makes binaries only for the runtime environments it is asked for: -e on the command line, target.runtimeEnv in crossbind.config.js, or a bundler plugin. Remove export.bundle.');
    }
    const { runtimeEnv } = config.target;
    if (runtimeEnv !== undefined && runtimeEnv !== null && !RUNTIME_ENVS.includes(runtimeEnv)) {
        throw new Error(`crossbind: target.runtimeEnv must be one of ${RUNTIME_ENVS.join(', ')} (got ${JSON.stringify(runtimeEnv)}).`);
    }
}

export default async function loadConfig(configDir = process.cwd(), configName = 'crossbind.config') {
    const config = await loadJs(configDir, configName) || {};
    if (config.excludedDependencies?.length) {
        logger.info('crossbind: `excludedDependencies` in crossbind.config.js is no longer read — declare exclusions in crossbind.overrides.js as { <name>: false }.');
    }
    const overrides = await loadJs(configDir, 'crossbind.overrides');
    const exclude = resolveExcludedNames(overrides);
    const seen = new Set();
    const output = getFilledConfig(config, { isDepend: false, exclude, seen, replaces: overrides });
    output.excludedDependencies = exclude;

    const build = await loadJs(configDir, 'crossbind.build');

    if (build) {
        build.withBuildConfig = true;
    }
    output.build = { ...build, ...output.build };

    if (overrides) {
        Object.entries(overrides).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') {
                logger.info(`crossbind: crossbind.overrides["${key}"] must be an object — { rebuild: true } / { exclude: true } / { replace: ... }.`);
            }
        });
        output.allDependencies.forEach((d) => {
            const resolved = resolveDependencyOverride(overrides, d);
            if (resolved) {
                d.overrideBuild = resolved.override;
                d.rebuild = true;
            }
        });
        const unmatched = Object.keys(overrides).filter((k) => !seen.has(k));
        if (unmatched.length) {
            logger.info(`crossbind: crossbind.overrides entries not matched to any dependency: ${unmatched.join(', ')}. Available: ${[...seen].sort().join(', ')}`);
        }
    }

    // Consume any dependency already rebuilt from source (buildDependencies writes the marker) so the
    // fresh artifacts win across processes — e.g. Android rebuilds at the Gradle config phase and is
    // consumed when the CMake phase reloads the config.
    output.allDependencies.forEach((d) => {
        const depsDir = `${output.paths.cache}/deps/${d.general.name}`;
        const meta = loadJson(`${depsDir}/.crossbind-rebuild.json`);
        if (!meta || meta.key !== getOverrideKey(d)) return;
        if (!fs.existsSync(`${depsDir}/dist/prebuilt/CMakeLists.txt`)) {
            logger.info(`crossbind: rebuilt cache for "${d.general.name}" is incomplete (missing dist/prebuilt/CMakeLists.txt) — using prebuilt. Rebuild, or reset with \`crossbind clean-deps\`.`);
            return;
        }
        d.paths.output = `${depsDir}/dist`;
        if (d.export.libName.some((n) => fs.existsSync(`${depsDir}/${n}.xcframework`))) {
            d.paths.project = depsDir;
        }
    });

    output.paths.systemConfig = `${os.homedir()}/.crossbind.json`;
    output.system = loadJson(output.paths.systemConfig) || {};

    Object.entries(systemKeys).forEach(([key, value]) => {
        if (!(key in output.system)) {
            output.system[key] = value.default;
        }
    });

    return output;
}

// Direct and transitive dependencies, one entry per package directory.
export function flattenDependencies(dependencies) {
    const output = {};
    [...dependencies, ...dependencies.map((d) => d.allDependencies).flat()].forEach((d) => {
        output[d.paths.project] = d;
    });
    return Object.values(output);
}

export function getFilledConfig(config, options = { isDepend: false }) {
    const exclude = options.exclude || [];
    const { seen, replaces } = options;

    const dependencies = (config.dependencies || [])
        .map((d) => {
            const filled = getFilledConfig(d, { isDepend: true, exclude, seen, replaces });
            const replacement = resolveDependencyReplace(replaces, filled);
            if (!replacement) return filled;
            return restampIdentity(getFilledConfig(replacement, { isDepend: true, exclude, seen, replaces }), filled);
        })
        .filter((fd) => {
            const names = [fd.general.name, fd.package?.name, fd.general.alias?.package].filter(Boolean);
            names.forEach((n) => seen?.add(n));
            return !names.some((n) => exclude.includes(n));
        });

    const newConfig = {
        general: config.general || {},
        dependencies,
        cargoDependencies: config.cargoDependencies || {},
        conanDependencies: normalizeConanDependencies(config.conanDependencies),
        // 'sync' types the direct surface; 'promise' wraps every generated method return
        // for useWorker-style runtimes (constructors stay sync-typed: await new X()).
        dts: config.dts || 'sync',
        // Opt-in package type publishing: emit <output>/types/index.d.ts over the public
        // headers and wire package.json types/typesVersions (see actions/buildTypes.js).
        types: config.types || false,
        // Cloned: raw crossbind.config modules are import singletons; later path mutations
        // (e.g. rebuild-marker consumption) must not leak into them across loadConfig calls.
        paths: { ...(config.paths || {}) },
        ext: config.ext || {},
        export: config.export || {},
        targetSpecs: config.targetSpecs || [],
        build: config.build || {},
        target: config.target || {},
        extensions: config.extensions || [],
        package: null,
        functions: config.functions || {},
    };

    if (!['sync', 'promise'].includes(newConfig.dts)) {
        throw new Error(`crossbind: "dts" must be 'sync' or 'promise' (got '${newConfig.dts}').`);
    }
    if (typeof newConfig.types !== 'boolean') {
        throw new Error(`crossbind: "types" must be true or false (got '${newConfig.types}').`);
    }
    if (newConfig.targetSpecs.some((t) => Array.isArray(t?.specs?.cmake))) {
        throw new Error('crossbind: "targetSpecs[].specs.cmake" must be an object such as { compileOptions: [\'-O3\'] } (got an array). CMake configure flags (-D...) belong in a recipe\'s getBuildParams.');
    }

    if (newConfig.paths.config && !newConfig.paths.project) {
        newConfig.paths.project = getParentPath(newConfig.paths.config);
    }

    if (!newConfig.paths.project) {
        newConfig.paths.project = process.cwd();
    } else {
        newConfig.paths.project = getAbsolutePath(null, newConfig.paths.project);
    }

    newConfig.package = loadJson(`${newConfig.paths.project}/package.json`);

    if (!newConfig?.general?.name) {
        if (!newConfig.package) {
            throw new Error(`crossbind: no package.json found in ${newConfig.paths.project}. Run crossbind from your project root, or scaffold a project with \`npm create crossbind\`.`);
        }
        newConfig.general.name = fixPackageName(newConfig.package.name) || 'crossbindsample';
    }

    const getPath = getAbsolutePath.bind(null, newConfig.paths.project);

    newConfig.paths.base = getPath(newConfig.paths.base) || newConfig.paths.project;
    newConfig.paths.cache = getPath(newConfig.paths.cache) || getPath('.crossbind');
    newConfig.paths.build = getPath(newConfig.paths.build) || getPath(`${newConfig.paths.cache}/build`);
    newConfig.paths.native = (newConfig.paths.native || ['src/native']).map((p) => getPath(p));
    newConfig.paths.module = (newConfig.paths.module || newConfig.paths.native).map((p) => getPath(p));
    newConfig.paths.header = (newConfig.paths.header || newConfig.paths.native).map((p) => getPath(p));
    newConfig.paths.bridge = (newConfig.paths.bridge || [...newConfig.paths.native, newConfig.paths.build])
        .map((p) => getPath(p));
    newConfig.paths.output = getPath(newConfig.paths.output) || newConfig.paths.build;
    newConfig.paths.cmake = options.isDepend ? getPath(getCMakeListsFilePath(newConfig.paths.output)) : (
        getPath(newConfig.paths.cmake || getCMakeListsFilePath(newConfig.paths.project))
    );
    newConfig.paths.cmakeDir = getParentPath(newConfig.paths.cmake);
    newConfig.paths.cli = getParentPath(getParentPath(import.meta.url));
    newConfig.paths.cliCMakeListsTxt = `${newConfig.paths.cli}/assets/cmake/CMakeLists.txt`;

    newConfig.ext.header = newConfig.ext.header || ['h', 'hpp', 'hxx', 'hh'];
    newConfig.ext.source = newConfig.ext.source || ['c', 'cpp', 'cxx', 'cc'];
    newConfig.ext.module = newConfig.ext.module || ['i'];

    newConfig.export.type = newConfig.export.type || 'cmake';
    newConfig.export.header = newConfig.export.header || 'include';
    newConfig.export.libPath = getPath(newConfig.export.libPath || 'lib');
    newConfig.export.libName = newConfig.export.libName || [newConfig.general.name];
    newConfig.export.binHeaders = newConfig.export.binHeaders || [];

    newConfig.allDependencies = flattenDependencies(newConfig.dependencies);

    newConfig.extensions?.forEach(e => {
        e?.loadConfig?.after(newConfig);
    });

    if (newConfig.target.runtime !== 'mt' && newConfig.allDependencies.some((d) => d?.target?.runtime === 'mt')) {
        newConfig.target.runtime = 'mt';
    }

    newConfig.functions.isEnabled = newConfig.functions.isEnabled || ((target) => {
        // Source-cmake packages ship no prebuilt at all: their own CMakeLists (at the
        // package root, not a generated dist/prebuilt one) is compiled into the consuming
        // build via add_subdirectory, so they serve every target.
        const isSourceCmakePackage = newConfig.export?.type === 'cmake'
            && newConfig.paths.cmake !== newConfig.paths.cliCMakeListsTxt
            && !newConfig.paths.cmakeDir.endsWith('/prebuilt')
            && fs.existsSync(newConfig.paths.cmake);

        return (
            isSourceCmakePackage
            || fs.existsSync(`${newConfig.paths.cmakeDir}/${target.path}`)
            || fs.existsSync(`${newConfig.paths.cmakeDir}/${target.releasePath}`)
            || (target.platform === 'ios' && fs.existsSync(`${newConfig.paths.cmakeDir}/../../${newConfig.general.name}-${target.runtime}.xcframework`))
        );
    });

    newConfig.dependencyParameters = calculateDependencyParameters(newConfig);
    // newConfig.cmakeParameters = getCmakeParameters(newConfig);

    return newConfig;
}

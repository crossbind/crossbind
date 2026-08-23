import fs from 'node:fs';
import state, { setAllDependecyPaths } from '../state/index.js';
import loadConfig from '../state/loadConfig.js';
import loadJson from '../utils/loadJson.js';
import writeJson from '../utils/writeJson.js';
import logger from '../utils/logger.js';
import { getBuildTargets } from './target.js';
import buildExternal from './buildExternal.js';
import buildLib from './buildLib.js';
import createXCFramework from './createXCFramework.js';
import { mergeBuildOverride, getOverrideKey } from '../utils/overrideDependency.js';
import {
    isCached, getRebuildDeps, orderByDependencies, computeDependenciesStamp,
} from '../utils/dependencyRebuild.js';
import withDirLock from '../utils/dirLock.js';
import { prepareRustSysroot } from '../utils/rustSysroot.js';

export default async function buildDependencies({ targetParams, rebuildOption }) {
    // Before the early returns below: this is the one async step every build path awaits, and the
    // sync cargo work downstream reads what it resolves. A project with nothing to rebuild still
    // needs its sysroot.
    await prepareRustSysroot(getBuildTargets(targetParams));
    await buildMissingCargoDependencies(getBuildTargets(targetParams), targetParams);

    const rebuildDeps = getRebuildDeps(state.config.allDependencies, rebuildOption);
    if (rebuildDeps.length === 0) return;

    const targets = getBuildTargets(targetParams);
    if (targets.length === 0) return;
    const hasIos = targets.some((t) => t.platform === 'ios');

    const appConfig = state.config;
    const ordered = orderByDependencies(rebuildDeps);

    for (const dep of ordered) {
        const name = dep.general.name;
        const depsDir = `${appConfig.paths.cache}/deps/${name}`;
        const key = getOverrideKey(dep);

        const isUsable = await withDirLock(`${depsDir}.lock`, async () => {
            if (isCached(depsDir, targets, key, dep, hasIos)) {
                logger.info(`crossbind: dependency "${name}" rebuild up to date (cached).`);
                return true;
            }
            return rebuildDependency({
                dep, name, depsDir, key, targetParams, hasIos, appConfig,
            });
        });
        if (!isUsable) continue;

        dep.paths.output = `${depsDir}/dist`;
        if (hasIos) dep.paths.project = depsDir;
        setAllDependecyPaths();
    }
}

// A cargo dependency carries every target in ONE package, so unlike a platform-split port there
// is no "this sibling isn't for this target" case: a missing prebuilt means it was never built.
// Nothing else builds these packages - buildDependencies only rebuilds deps that carry a source
// recipe, and a cargo package carries none - so an app with a plugin used to need a manual
// pre-build step nobody had written down. Worse, only the cmake link asserts the dependency is
// there: on wasm a missing one silently drops out and the module builds clean, then dies at init.
// Build it here instead, in the dependency's own package, where its prebuilt belongs.
async function buildMissingCargoDependencies(targets, targetParams) {
    if (targets.length === 0) return;
    const appConfig = state.config;
    const missing = (appConfig.allDependencies ?? []).filter((dep) => dep !== appConfig
        && dep.export?.type === 'cargo'
        && targets.some((target) => !dep.functions.isEnabled(target)));

    for (const dep of missing) {
        const name = dep.general.name;
        // isEnabled reads the filesystem on every call, so a build that lands while this one waits
        // for the lock is picked up without any state to refresh.
        await withDirLock(`${dep.paths.output}.autobuild.lock`, async () => {
            if (targets.every((target) => dep.functions.isEnabled(target))) return;
            logger.info(`crossbind: building cargo dependency "${name}" - it has no prebuilt for this target yet…`);
            const scoped = await loadConfig(dep.paths.project);
            const prev = state.config;
            state.config = scoped;
            try {
                buildLib(targetParams);
            } finally {
                state.config = prev;
            }
        });
    }

    // The build above is the fix; this is the guard behind it. assertDependsBuilt only runs while
    // the cmake link is being configured, so a cached native build skips the check and a missing
    // cargo dependency reaches the app anyway - measured on wasm as a clean BUILD=0 whose module
    // then failed 22 of 43 conformance features at init. Here the answer is known either way.
    const unresolved = missing.filter((dep) => targets.some((target) => !dep.functions.isEnabled(target)));
    if (unresolved.length > 0) {
        const names = unresolved.map((dep) => `"${dep.general.name}"`).join(', ');
        throw new Error(`crossbind: cargo ${unresolved.length > 1 ? 'dependencies' : 'dependency'} ${names} still `
            + `${unresolved.length > 1 ? 'have' : 'has'} no prebuilt for ${targets.map((t) => t.path).join(', ')} `
            + 'after building. Linking without it produces a module that builds clean and dies at init.');
    }
}

async function rebuildDependency({
    dep, name, depsDir, key, targetParams, hasIos, appConfig,
}) {
    const scoped = await loadConfig(dep.paths.project);
    if (!scoped.build?.withBuildConfig) {
        logger.info(`crossbind: dependency "${name}" has no source build recipe (crossbind.build); using prebuilt.`);
        return false;
    }

    const override = dep.overrideBuild;
    if (override) {
        scoped.build = mergeBuildOverride(scoped.build, override);
        if (override.nativeVersion) {
            scoped.package = { ...scoped.package, nativeVersion: override.nativeVersion };
        }
        if (override.targetSpecs) scoped.targetSpecs = [...(scoped.targetSpecs || []), ...override.targetSpecs];
        if (override.export) scoped.export = { ...scoped.export, ...override.export };
    }

    // All build I/O must stay under the app base (Docker mount) — never the dep's own node_modules.
    // output = depsDir/dist (libs) and project = depsDir (xcframework) mirror a normal package layout
    // so createXCFramework's project->output relative path resolves; paths.project stays the dep pkg
    // dir for the recipe's copyToSource asset reads.
    scoped.paths.base = appConfig.paths.base;
    scoped.paths.output = `${depsDir}/dist`;
    scoped.paths.build = `${depsDir}/build`;
    scoped.paths.cache = depsDir;
    scoped.allDependencyPaths = appConfig.allDependencyPaths;

    const stale = loadJson(`${depsDir}/.crossbind-rebuild.json`)?.key !== key;
    if (stale) fs.rmSync(depsDir, { recursive: true, force: true });
    fs.mkdirSync(depsDir, { recursive: true });

    logger.info(`crossbind: rebuilding dependency "${name}" from source (v${scoped.package.nativeVersion})…`);
    const prev = state.config;
    state.config = scoped;
    try {
        await buildExternal(targetParams, { skipXcframework: hasIos });
        if (hasIos) {
            createXCFramework({
                paths: { project: depsDir, output: `${depsDir}/dist` },
                export: { libName: dep.export.libName },
                targetParams,
            });
        }
    } finally {
        state.config = prev;
    }

    writeJson(`${depsDir}/.crossbind-rebuild.json`, { key });
    return true;
}

export function getDependenciesStamp() {
    return computeDependenciesStamp(state.config.allDependencies, state.config.paths.cache);
}

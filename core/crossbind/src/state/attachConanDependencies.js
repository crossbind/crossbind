import { getFilledConfig, flattenDependencies } from './loadConfig.js';
import calculateDependencyParameters from './calculateDependencyParameters.js';
import { conanStageDir, conanPackageDir } from '../utils/conanImport.js';
import { conanDependenciesKey } from '../utils/conanDependencies.js';
import { readConanManifest, conanTargetName } from '../utils/conanStage.js';
import { TARGETS, targetPathOf } from '../utils/targets.js';

// What a recipe declares for its consumers, per staged target since it declares other things on another
// platform: the defines your code compiles with, and the system libraries and frameworks a Node.js addon
// or a native executable links. A framework goes as one linker argument: CMake collapses a repeated
// -framework. A debug build takes the release packages, so the build type is left out, and a target's
// specs stay one object, as getData takes them.
function targetSpecsOf(name, targets) {
    return Object.entries(targets).flatMap(([targetPath, packages]) => {
        const target = TARGETS.find((t) => targetPathOf(t) === targetPath);
        const pkg = packages.find((entry) => entry.name === name);
        if (!target || !pkg) return [];
        const compileOptions = pkg.defines.map((define) => `-D${define}`);
        const addonFlags = [...pkg.frameworks.map((framework) => `-Wl,-framework,${framework}`), ...pkg.systemLibs.map((lib) => `-l${lib}`)];
        const specs = {
            ...(compileOptions.length > 0 ? { cmake: { compileOptions } } : {}),
            ...(addonFlags.length > 0 ? { binary: { addonFlags } } : {}),
        };
        if (Object.keys(specs).length === 0) return [];
        return [{
            platform: target.platform, arch: target.arch, runtime: target.runtime, specs,
        }];
    });
}

// Every library a recipe names on some target (libpng is png16 on Windows): a target links the archives
// staged for it, so a name it lacks drops out there.
const libsOf = (name, targets) => [...new Set(Object.values(targets).flat().filter((entry) => entry.name === name).flatMap((entry) => entry.libs))];

export function conanDependencyConfigs(manifest, stageDir) {
    return manifest.packages.map((pkg) => ({
        general: { name: conanTargetName(pkg.name), conan: pkg },
        export: { type: 'cmake', libName: libsOf(pkg.name, manifest.targets) },
        paths: { project: conanPackageDir(stageDir, pkg.name), output: `${conanPackageDir(stageDir, pkg.name)}/dist` },
        targetSpecs: targetSpecsOf(pkg.name, manifest.targets),
    }));
}

// The staged Conan packages join the config as dependencies, so header resolution, the link, the
// cmake graph and the license rows see them like any port. Only packages staged for the current
// conanDependencies join; reading the manifest runs nothing, so state can do it while it loads.
export default function attachConanDependencies(config) {
    const isDeclared = Object.keys(config.conanDependencies ?? {}).length > 0;
    if (!isDeclared && !config.dependencies?.some((d) => d.general.conan)) return;
    const stageDir = conanStageDir(config.paths.cache);
    const manifest = isDeclared ? readConanManifest(stageDir, conanDependenciesKey(config.conanDependencies)) : null;
    const conan = manifest ? conanDependencyConfigs(manifest, stageDir).map((d) => getFilledConfig(d, { isDepend: true })) : [];
    config.dependencies = [...config.dependencies.filter((d) => !d.general.conan), ...conan];
    config.allDependencies = flattenDependencies(config.dependencies);
    config.dependencyParameters = calculateDependencyParameters(config);
}

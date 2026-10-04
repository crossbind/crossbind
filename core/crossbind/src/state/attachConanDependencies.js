import { getFilledConfig, flattenDependencies } from './loadConfig.js';
import calculateDependencyParameters from './calculateDependencyParameters.js';
import { conanStageDir, conanPackageDir } from '../utils/conanImport.js';
import { conanDependenciesKey } from '../utils/conanDependencies.js';
import { readConanManifest, conanTargetName } from '../utils/conanStage.js';
import { TARGETS, targetPathOf } from '../utils/targets.js';

// The system libraries and frameworks a recipe asks the link for, as the flags a Node.js addon or a
// native executable takes them with. A framework goes as one linker argument: CMake collapses a
// repeated -framework.
const linkFlagsOf = (pkg) => [...pkg.frameworks.map((name) => `-Wl,-framework,${name}`), ...pkg.systemLibs.map((name) => `-l${name}`)];

// Per staged target, since a recipe asks for other libraries on another platform. A debug build links
// the release packages, so the build type is left out.
function linkSpecsOf(name, targets) {
    return Object.entries(targets).flatMap(([targetPath, packages]) => {
        const target = TARGETS.find((t) => targetPathOf(t) === targetPath);
        const pkg = packages.find((entry) => entry.name === name);
        const addonFlags = pkg ? linkFlagsOf(pkg) : [];
        if (!target || addonFlags.length === 0) return [];
        return [{
            platform: target.platform, arch: target.arch, runtime: target.runtime, specs: { binary: { addonFlags } },
        }];
    });
}

export function conanDependencyConfigs(manifest, stageDir) {
    return manifest.packages.map((pkg) => ({
        general: { name: conanTargetName(pkg.name), conan: pkg },
        export: { type: 'cmake', libName: pkg.libs },
        paths: { project: conanPackageDir(stageDir, pkg.name), output: `${conanPackageDir(stageDir, pkg.name)}/dist` },
        targetSpecs: linkSpecsOf(pkg.name, manifest.targets),
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

import { getFilledConfig, flattenDependencies } from './loadConfig.js';
import calculateDependencyParameters from './calculateDependencyParameters.js';
import { sourceStageDir, sourcePackageDir } from '../utils/packageSourceImport.js';
import { declaredSources, dependenciesKey, dependenciesOf } from '../utils/packageSources.js';
import { readSourceManifest, sourceTargetName } from '../utils/packageSourceStage.js';
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

export function sourceDependencyConfigs(source, manifest, stageDir) {
    return manifest.packages.map((pkg) => ({
        general: { name: sourceTargetName(source, pkg.name), packageSource: { name: source, package: pkg } },
        export: { type: 'cmake', libName: libsOf(pkg.name, manifest.targets) },
        paths: { project: sourcePackageDir(stageDir, pkg.name), output: `${sourcePackageDir(stageDir, pkg.name)}/dist` },
        targetSpecs: targetSpecsOf(pkg.name, manifest.targets),
    }));
}

function stagedDependencies(config, source) {
    const stageDir = sourceStageDir(config.paths.cache, source);
    const manifest = readSourceManifest(source, stageDir, dependenciesKey(dependenciesOf(config, source)));
    return manifest ? sourceDependencyConfigs(source, manifest, stageDir).map((d) => getFilledConfig(d, { isDepend: true })) : [];
}

// The staged packages of each source join the config as dependencies, so header resolution, the link, the
// cmake graph and the license rows see them like any port. Only packages staged for what the config declares
// now join; reading a manifest runs nothing, so state can do it while it loads.
export default function attachPackageSources(config) {
    const declared = declaredSources(config);
    if (declared.length === 0 && !config.dependencies?.some((d) => d.general.packageSource)) return;
    const staged = declared.flatMap(({ name }) => stagedDependencies(config, name));
    config.dependencies = [...config.dependencies.filter((d) => !d.general.packageSource), ...staged];
    config.allDependencies = flattenDependencies(config.dependencies);
    config.dependencyParameters = calculateDependencyParameters(config);
}

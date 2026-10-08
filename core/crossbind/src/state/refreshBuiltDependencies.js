import calculateDependencyParameters from './calculateDependencyParameters.js';
import getAbsolutePath from '../utils/getAbsolutePath.js';
import getCMakeListsFilePath, { getCliCMakeListsFile } from '../utils/getCMakeListsFilePath.js';
import getParentPath from '../utils/getParentPath.js';

// A dependency with no build when the config loaded resolved to the CLI's own CMakeLists, which keeps it out of the link
// and its headers out of the dependency include roots: a process that outlives the build, such as a Metro server, takes it
// in here. Says whether it took one in.
export default function refreshBuiltDependencies(config) {
    const built = (config.allDependencies ?? [])
        .filter((dep) => dep !== config && ['cmake', 'cargo'].includes(dep.export?.type) && dep.paths.cmake === config.paths.cliCMakeListsTxt)
        .map((dep) => ({ dep, cmake: getCMakeListsFilePath(dep.paths.output) }))
        .filter(({ cmake }) => cmake !== getCliCMakeListsFile());
    built.forEach(({ dep, cmake }) => {
        dep.paths.cmake = getAbsolutePath(dep.paths.project, cmake);
        dep.paths.cmakeDir = getParentPath(dep.paths.cmake);
    });
    if (built.length > 0) config.dependencyParameters = calculateDependencyParameters(config);
    return built.length > 0;
}

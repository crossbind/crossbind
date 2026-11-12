import findFiles from '../utils/findFiles.js';
import xcframeworkSliceOf from '../utils/xcframeworkSlice.js';
import state from '../state/index.js';
import { getFilteredTargetSpec } from './target.js';

export default function getDependLibs(target) {
    let dependLibs = [
        ...findFiles(`${state.config.paths.build}/Source-Release/${target.path}/dependencies/**/*.a`, { cwd: state.config.paths.project }),
    ];
    state.config.dependencyParameters.getCmakeDepends(target).forEach((d) => {
        if (d.export.libName) {
            const ignoreLibNames = getFilteredTargetSpec(d?.targetSpecs, target).map(s => s.ignoreLibName).flat();
            d.export.libName.forEach((fileName) => {
                if (ignoreLibNames?.includes(fileName)) return;
                // On Android a package ships the shared library React Native packages, which an app carries beside
                // its host.
                const extensions = target.platform === 'android' ? ['a', 'so'] : ['a'];
                const libsIn = (targetPath) => extensions
                    .map((extension) => findFiles(`${d.paths.output}/prebuilt/${targetPath}/lib/lib${fileName}.${extension}`, { cwd: d.paths.project }))
                    .find((found) => found.length > 0) ?? [];
                let libPaths = libsIn(target.path);
                if (libPaths.length === 0) {
                    libPaths = libsIn(target.releasePath);
                }
                // A published port can leave its iOS archive to its xcframework: the one of this package, as a project
                // can list the port's packages of other platforms, whose libraries share the name.
                if (libPaths.length === 0 && target.platform === 'ios') {
                    libPaths = findFiles(`${xcframeworkSliceOf(d.paths.project, fileName, target)}/lib${fileName}.a`, { cwd: d.paths.project });
                }
                dependLibs.push(...libPaths);
            });
        }
    });

    dependLibs = [...new Set(dependLibs)];
    return dependLibs;
}

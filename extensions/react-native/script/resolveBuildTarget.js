import { getTargetParams, getFilteredBuildTargets } from './crossbind.js';

export default function resolveBuildTarget(arch, buildType) {
    const targetParams = getTargetParams({ platform: ['android'], arch: [arch], runtime: ['mt'] }, true);
    let buildTargetRelease = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];
    let buildTargetDebug = getFilteredBuildTargets(targetParams, { buildType: 'debug' })?.[0];

    if (!buildTargetRelease && !buildTargetDebug) {
        throw new Error(`No Android build targets found for arch "${arch}"`);
    }

    if (!buildTargetDebug) {
        buildTargetDebug = buildTargetRelease;
    } else if (!buildTargetRelease) {
        buildTargetRelease = buildTargetDebug;
    }

    return buildType === 'Release' ? buildTargetRelease : buildTargetDebug;
}

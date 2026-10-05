import base from '@crossbind/port-proj/build.mjs';

const multicallEntry = { kind: 'multicall-entry', publish: true };

export default {
    ...base,
    getBuildParams: (target, depPaths) => [
        ...base.getBuildParams(target, depPaths).filter((p) => p !== '-DBUILD_APPS=OFF'),
        '-DBUILD_APPS=ON',
        '-DBUILD_PROJSYNC=OFF',
        // Static libtiff carries no dep metadata: append zlib at the end of C++ links.
        ...(depPaths.z ? [`-DCMAKE_CXX_STANDARD_LIBRARIES=${depPaths.z.lib}`] : []),
    ],
    bin: {
        // optargpm.h defines its helpers in each app object; identical copies are safe to fold.
        multicall: { linkTarget: 'binproj', sourcesDir: 'src/apps', linkFlags: ['-Wl,--allow-multiple-definition'] },
        tools: {
            proj: { kind: 'binary', publish: true },
            cct: multicallEntry,
            cs2cs: multicallEntry,
            geod: multicallEntry,
            gie: multicallEntry,
            projinfo: multicallEntry,
        },
    },
};

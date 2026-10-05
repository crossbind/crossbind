import base from '@crossbind/port-geos/build.mjs';

export default {
    ...base,
    // wasi fenv.h lacks the FE_* exception macros; harden geosop's HAVE_FENV guards.
    replaceList: [
        ...(base.replaceList || []),
        {
            regex: '#if defined\\(HAVE_FENV\\)',
            replacement: '#if defined(HAVE_FENV) && defined(FE_INEXACT)',
            paths: ['util/geosop/GeosOp.cpp'],
        },
    ],
    getBuildParams: (target) => [
        ...base.getBuildParams(target).filter((p) => p !== '-DBUILD_GEOSOP=OFF'),
        '-DBUILD_GEOSOP=ON',
    ],
    bin: { tools: { geosop: { kind: 'binary', publish: true } } },
};

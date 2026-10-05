import base from '@crossbind/port-jpegturbo/build.mjs';

export default {
    ...base,
    getBuildParams: (target, depPaths, ext, buildPath) => [
        ...base.getBuildParams(target, depPaths, ext, buildPath).filter((p) => p !== '-DWITH_TOOLS=OFF'),
        '-DWITH_TOOLS=ON',
    ],
    bin: {
        tools: {
            cjpeg: { kind: 'binary', publish: true },
            djpeg: { kind: 'binary', publish: true },
            jpegtran: { kind: 'binary', publish: true },
        },
    },
};

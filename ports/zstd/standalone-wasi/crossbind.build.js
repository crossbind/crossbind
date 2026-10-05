import base from '@crossbind/port-zstd/build.mjs';

export default {
    ...base,
    // wasi-libc has no chown; ownership copying is meaningless there - stub it to 0.
    replaceList: [
        ...(base.replaceList || []),
        {
            regex: 'res \\+= chown\\(',
            replacement: 'res += 0; (void)(',
            paths: ['programs/util.c'],
        },
    ],
    getBuildParams: (target) => [
        ...base.getBuildParams(target).filter((p) => p !== '-DZSTD_BUILD_PROGRAMS=OFF'),
        '-DZSTD_BUILD_PROGRAMS=ON',
    ],
    bin: { tools: { zstd: { kind: 'binary', publish: true } } },
};

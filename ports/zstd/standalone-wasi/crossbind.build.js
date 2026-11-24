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
        // fileio.c calls close() since 1.6.0, but zstd includes unistd.h only where it detects POSIX, which WASI is not.
        {
            regex: '#include <fcntl.h>',
            replacement: '#include <unistd.h>\n#include <fcntl.h>',
            paths: ['programs/fileio.c'],
        },
    ],
    getBuildParams: (target) => [
        ...base.getBuildParams(target).filter((p) => p !== '-DZSTD_BUILD_PROGRAMS=OFF'),
        '-DZSTD_BUILD_PROGRAMS=ON',
    ],
    bin: { tools: { zstd: { kind: 'binary', publish: true } } },
};

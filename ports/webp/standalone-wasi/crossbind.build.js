import base from '@crossbind/port-webp/build.mjs';

const OFF = ['-DWEBP_BUILD_CWEBP=OFF', '-DWEBP_BUILD_DWEBP=OFF', '-DWEBP_BUILD_WEBPINFO=OFF'];

export default {
    ...base,
    getBuildParams: (target) => [
        ...base.getBuildParams(target).filter((p) => !OFF.includes(p)),
        '-DWEBP_BUILD_CWEBP=ON', '-DWEBP_BUILD_DWEBP=ON', '-DWEBP_BUILD_WEBPINFO=ON',
    ],
    bin: {
        tools: {
            cwebp: { kind: 'binary', publish: true },
            dwebp: { kind: 'binary', publish: true },
            webpinfo: { kind: 'binary', publish: true },
        },
    },
};

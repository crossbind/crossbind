import base from '@crossbind/port-curl/build.mjs';

export default {
    ...base,
    getBuildParams: (target, depPaths) => [
        ...base.getBuildParams(target, depPaths).filter((p) => p !== '-DBUILD_CURL_EXE=OFF'),
        '-DBUILD_CURL_EXE=ON',
    ],
    bin: { tools: { curl: { kind: 'binary', publish: true } } },
};

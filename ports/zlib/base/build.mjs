export default {
    sha256: '02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584', // zlib-1.4.tar.gz
    // zlib.net drops superseded releases and its edge occasionally serves other bytes; the GitHub asset is stable.
    getURL: (version) => `https://github.com/madler/zlib/releases/download/v${version}/zlib-${version}.tar.gz`,
    getMirrors: (version) => [
        `https://zlib.net/zlib-${version}.tar.gz`,
        `https://zlib.net/fossils/zlib-${version}.tar.gz`,
    ],
    buildType: 'cmake',
    // On Windows zlib names its static library zs; every consumer links it as z.
    replaceList: [
        {
            regex: 'set\\(zlib_static_suffix "s"\\)',
            replacement: 'set(zlib_static_suffix "")',
            paths: ['CMakeLists.txt'],
        },
    ],
    // Static on every platform, as OpenSSL is: an Android app process already holds the system libz.so, which would
    // shadow a shared build of this one. The archive goes into shared libraries there, so it must be PIC, and its
    // symbols are hidden so that each of those libraries keeps its copy private instead of exporting it.
    getBuildParams: (target) => [
        '-DZLIB_BUILD_SHARED=OFF',
        ...(target.platform === 'android'
            ? ['-DCMAKE_POSITION_INDEPENDENT_CODE=ON', '-DCMAKE_C_VISIBILITY_PRESET=hidden']
            : []),
        '-DZLIB_BUILD_TESTING=OFF',
    ],
};

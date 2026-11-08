export default {
    sha256: 'c27ad72a68da151177929aa969ae773a2da5ac2af9ce946079314fdac8cece7f', // libjpeg-turbo-3.2.1.tar.gz
    getURL: (version) => `https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${version}/libjpeg-turbo-${version}.tar.gz`,
    buildType: 'cmake',
    // The typed forms of variadic calls crossbind adds (see the header), shipped beside the upstream headers.
    copyToDist: {
        'node_modules/@crossbind/port-jpegturbo/include/jpeglib_crossbind.h': 'include/jpeglib_crossbind.h',
    },
    getBuildParams: (target) => {
        if (target.platform === 'android') {
            return [
                '-DENABLE_SHARED=ON',
                '-DENABLE_STATIC=OFF',
                '-DWITH_TURBOJPEG=ON',
                '-DWITH_TOOLS=OFF',
                '-DWITH_TESTS=OFF',
            ];
        }
        if (target.platform === 'ios') {
            return [
                '-DENABLE_SHARED=OFF',
                '-DENABLE_STATIC=ON',
                '-DWITH_TURBOJPEG=ON',
                '-DWITH_TOOLS=OFF',
                '-DWITH_TESTS=OFF',
                // simdcoverage executable is gated only by WITH_SIMD AND ENABLE_STATIC; disable signing so it builds without a development certificate.
                '-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO',
                '-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_REQUIRED=NO',
            ];
        }
        if (['wasi', 'darwin', 'linux', 'linuxmusl', 'win32'].includes(target.platform)) {
            // The package ships the library only; on wasi the bundled
            // tools/tests would not even link as wasi commands.
            return [
                '-DENABLE_SHARED=OFF',
                '-DENABLE_STATIC=ON',
                '-DWITH_TURBOJPEG=ON',
                '-DWITH_TOOLS=OFF',
                '-DWITH_TESTS=OFF',
            ];
        }
        // wasm
        return [
            '-DENABLE_SHARED=OFF',
            '-DENABLE_STATIC=ON',
            '-DWITH_TURBOJPEG=ON',
        ];
    },
};

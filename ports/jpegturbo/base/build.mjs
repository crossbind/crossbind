export default {
    sha256: '6f30092cef9fb839779646608f4ee14ae3cbac989c47fa05e841b0841f09878e', // libjpeg-turbo-3.2.0.tar.gz
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
                '-DWITH_TURBOJPEG=OFF',
                '-DWITH_TOOLS=OFF',
                '-DWITH_TESTS=OFF',
            ];
        }
        if (target.platform === 'ios') {
            return [
                '-DENABLE_SHARED=OFF',
                '-DENABLE_STATIC=ON',
                '-DWITH_TURBOJPEG=OFF',
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
                '-DWITH_TURBOJPEG=OFF',
                '-DWITH_TOOLS=OFF',
                '-DWITH_TESTS=OFF',
            ];
        }
        // wasm
        return [
            '-DENABLE_SHARED=OFF',
            '-DENABLE_STATIC=ON',
            '-DWITH_TURBOJPEG=OFF',
        ];
    },
};

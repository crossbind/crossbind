const ifDep = (dep, params) => (dep ? params(dep) : []);

export default {
    getURL: (version) => `https://download.osgeo.org/libtiff/tiff-${version}.tar.gz`,
    sha256: '672bd7d10aee4606171afb864f3570b83340f6a33e2c186dc0512f7145ffdf6a', // tiff-4.7.2.tar.gz
    buildType: 'cmake',
    // The typed forms of variadic calls crossbind adds (see the header), shipped beside the upstream headers.
    copyToDist: {
        'node_modules/@crossbind/port-tiff/include/tiffio_crossbind.h': 'include/tiffio_crossbind.h',
    },
    getBuildParams: (target, depPaths) => [
        '-Dtiff-tools=OFF', '-Dtiff-tests=OFF', '-Dtiff-contrib=OFF',
        '-Dtiff-docs=OFF', '-Dld-version-script=OFF',
        // 4.7.2 defaults to Apple Frameworks, leaving lib/libtiff.a as an empty stub archive
        // that xcodebuild -create-xcframework rejects; keep the plain static-lib layout.
        '-Dtiff-framework=OFF',
        // Only android consumers link libtiff.so; on wasm the shared-lib link fails under
        // emsdk 6 (wasm-ld demands PIC deps), so pin static everywhere else — as gdal does.
        target.platform === 'android' ? '-DBUILD_SHARED_LIBS=ON' : '-DBUILD_SHARED_LIBS=OFF',
        ...ifDep(depPaths.z, (d) => [
            '-Dzlib=ON',
            `-DZLIB_INCLUDE_DIR=${d.header}`,
            `-DZLIB_LIBRARY=${d.lib}`,
            `-DZLIB_LIBRARY_RELEASE=${d.lib}`,
        ]),
        ...ifDep(depPaths.jpeg, (d) => [
            '-Djpeg=ON',
            `-DJPEG_INCLUDE_DIR=${d.header}`,
            `-DJPEG_LIBRARY=${d.lib}`,
        ]),
        ...ifDep(depPaths.zstd, (d) => [
            '-Dzstd=ON',
            `-DZSTD_INCLUDE_DIR=${d.header}`,
            `-DZSTD_LIBRARY=${d.lib}`,
        ]),
        ...ifDep(depPaths.Lerc, (d) => [
            '-Dlerc=ON',
            `-DLERC_INCLUDE_DIR=${d.header}`,
            `-DLERC_LIBRARY=${d.lib}`,
        ]),
    ],
};

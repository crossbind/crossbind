const ifDep = (dep, params) => (dep ? params(dep) : []);

export default {
    sha256: '791a0610547eeabb17006cfd49cdbd2034f3240f47ed5e88a1031811f4e2bcf3', // proj-9.9.0.tar.gz
    getURL: (version) => `https://download.osgeo.org/proj/proj-${version}.tar.gz`,
    buildType: 'cmake',
    getBuildParams: (target, depPaths) => [
        '-DENABLE_CURL=OFF', '-DBUILD_TESTING=OFF', '-DBUILD_APPS=OFF',
        // PROJ defaults EMBED_RESOURCE_FILES=ON for static builds (ours, since
        // BUILD_SHARED_LIBS=OFF), baking the ~10 MB proj.db into libproj.a and
        // through --whole-archive into every consumer wasm - while the same
        // proj.db already ships via the data preload. Keep the database out of
        // the binary; runtimes point PROJ at the data path instead.
        '-DEMBED_RESOURCE_FILES=OFF',
        ...ifDep(depPaths.sqlite3, (d) => [
            `-DSQLite3_INCLUDE_DIR=${d.header}`,
            `-DSQLite3_LIBRARY=${d.lib}`,
        ]),
        ...ifDep(depPaths.tiff, (d) => [
            `-DTIFF_INCLUDE_DIR=${d.header}`,
            `-DTIFF_LIBRARY_RELEASE=${d.lib}`,
        ]),
    ],
};

const platformBuild = {
    'wasm': ['--enable-shared=no', '--host=x86_64-pc-linux-gnu'],
    'wasi': ['--enable-shared=no', '--host=x86_64-pc-linux-gnu'],
    'android-arm64-v8a': ['--enable-static=no', '--host=aarch64-linux-android'],
    'android-x86_64': ['--enable-static=no', '--host=x86_64-linux-android'],
    'ios-iphoneos': ['--enable-shared=no', '--host=arm-apple-darwin'],
    'ios-iphonesimulator': ['--enable-shared=no', '--host=x86_64-apple-darwin'],
    'darwin-arm64': ['--enable-shared=no', '--host=aarch64-apple-darwin'],
    'darwin-x64': ['--enable-shared=no', '--host=x86_64-apple-darwin'],
    'linux-arm64': ['--enable-shared=no', '--host=aarch64-linux-gnu'],
    'linux-x64': ['--enable-shared=no', '--host=x86_64-linux-gnu'],
    'linuxmusl-arm64': ['--enable-shared=no', '--host=aarch64-linux-musl'],
    'linuxmusl-x64': ['--enable-shared=no', '--host=x86_64-linux-musl'],
    'win32-arm64': ['--enable-shared=no', '--host=aarch64-w64-mingw32'],
    'win32-x64': ['--enable-shared=no', '--host=x86_64-w64-mingw32'],
};

const MOBILE_LIBS = ['-lstdc++', '-lsqlite3', '-lm', '-ltiff', '-lgeos'];
const platformLibs = {
    'wasm': ['-lsqlite3'],
    // The geos probes link C++ archives through the C driver; wasi-clang
    // needs the C++/EH runtime spelled out, and -fwasm-exceptions at link
    // selects the eh/ sysroot variant that has libunwind.
    'wasi': ['-fwasm-exceptions', '-lc++', '-lc++abi', '-lunwind', '-lsqlite3'],
    'android': MOBILE_LIBS,
    'ios': MOBILE_LIBS,
    'darwin': MOBILE_LIBS,
    // The linux sysroot has libc++ only; it and proj need what glibc 2.28 still keeps in separate libraries.
    'linux': ['-lc++', '-lpthread', '-ldl', '-lsqlite3', '-lm', '-ltiff', '-lgeos'],
    'linuxmusl': ['-lc++', '-lsqlite3', '-lm', '-ltiff', '-lgeos'],
    'win32': ['-lc++', '-lsqlite3', '-ltiff', '-lgeos'],
};

const platformSourceReplaceList = {
    'android': [
        {
            regex: ' -lpthread',
            replacement: '',
            paths: ['configure', 'configure.ac', 'src/Makefile.in', 'src/Makefile.am'],
        },
    ],
};

const ifDep = (dep, params) => (dep ? params(dep) : []);

export default {
    sha256: '43be2dd349daffe016dd1400c5d11285828c22fea35ca5109f21f3ed50605080', // libspatialite-5.1.0.tar.gz
    getURL: (version) => `https://www.gaia-gis.it/gaia-sins/libspatialite-sources/libspatialite-${version}.tar.gz`,
    // libspatialite 5.1.0 ships autotools helpers from 2009 that predate aarch64,
    // so an arm64 build host cannot be identified. Both helpers come from current GNU.
    copyToSource: { 'config.sub': 'config.sub', 'config.guess': 'config.guess' },
    sourceReplaceList: (target) => [...(platformSourceReplaceList[target.platform] || [])],
    buildType: 'configure',
    getBuildParams: (target, depPaths) => [
        ...(platformBuild[target.platform] || platformBuild[`${target.platform}-${target.arch}`] || []),
        '--enable-geosadvanced=yes', '--enable-geopackage=yes', '--enable-examples=no', '--enable-minizip=no',
        '--enable-libxml2=no', '--enable-freexl=no', '--disable-rttopo', '--disable-gcp',
        ...ifDep(depPaths.geos, (d) => [`--with-geosconfig=${d.bin}/geos-config`]),
        ...ifDep(depPaths.sqlite3, (d) => [
            `SQLITE3_CFLAGS=-I${d.header}`,
            `SQLITE3_LIBS=-L${d.libPath}`,
        ]),
    ],
    getExtraLibs: (target) => platformLibs[target.platform] || [],
};

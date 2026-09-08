const platformBuild = {
    'wasm': ['--disable-shared', '--host=wasm32-unknown-emscripten'],

    'android-arm64-v8a': ['--disable-static', '--host=aarch64-linux-android', '--disable-rpath'],
    'android-x86_64': ['--disable-static', '--host=x86_64-linux-android', '--disable-rpath'],
    'ios-iphoneos': ['--disable-shared', '--host=arm-apple-darwin'],
    'ios-iphonesimulator': ['--disable-shared', '--host=x86_64-apple-darwin'],
};

const SQLITE_DEFINES = '-DSQLITE_NOHAVE_SYSTEM -DSQLITE_DISABLE_LFS -DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS3_PARENTHESIS -DSQLITE_ENABLE_JSON1 -DSQLITE_ENABLE_NORMALIZE -DSQLITE_ENABLE_COLUMN_METADATA -DHAVE_GETHOSTUUID=0 -DSQLITE_ENABLE_RTREE=1';

// Library packages ship archives only: the Makefile gates the CLI shell on HAVE_WASI_SDK, pin that gate shut on every platform.
const noShellReplaceList = [
    {
        regex: 'all: sqlite3\\$\\(T\\.exe\\)-\\$\\(HAVE_WASI_SDK\\)',
        replacement: 'all: sqlite3$(T.exe)-1',
        paths: ['Makefile.in'],
    },
    {
        regex: 'install: install-shell-\\$\\(HAVE_WASI_SDK\\)',
        replacement: 'install: install-shell-1',
        paths: ['Makefile.in'],
    },
];

export default {
    sha256: '0e9483900e92cd5de8fd48d16bf9200145a61f7fd5be542a5ac81d8a9516eb9c', // sqlite-autoconf-3530400.tar.gz
    // SQLite hosts each release under its release-year directory; bump RELEASE_YEAR together with
    // nativeVersion (the year cannot be derived from the version number).
    getURL: (version) => {
        const RELEASE_YEAR = 2026;
        const versionArray = version.split('.');
        const VERSION = (versionArray[0] * 1000000 + versionArray[1] * 10000 + versionArray[2] * 100).toString();
        return `https://www.sqlite.org/${RELEASE_YEAR}/sqlite-autoconf-${VERSION}.tar.gz`;
    },
    buildType: 'configure',
    sourceReplaceList: () => noShellReplaceList,
    getBuildParams: (target) => [
        // sqlite's autosetup has first-class wasi support: --with-wasi-sdk
        // wires the cross toolchain AND skips the shell binary (which needs
        // getrusage/signal beyond the emulation set).
        ...(target.platform === 'wasi'
            ? ['--disable-shared', `--with-wasi-sdk=${process.env.CROSSBIND_WASI_SDK_PATH || '/opt/wasi-sdk'}`]
            : (platformBuild[target.platform] || platformBuild[`${target.platform}-${target.arch}`] || [])),
        ...(target.runtime === 'mt' ? ['--enable-threadsafe'] : []),
    ],
    env: (target) => (target.platform === 'android'
        ? [
            `CFLAGS="-fPIE -fPIC ${SQLITE_DEFINES}"`,
            'LDFLAGS="-pie -Wl,-soname,libsqlite3.so"',
        ]
        : [
            `CFLAGS="${SQLITE_DEFINES}"`,
        ]),
};

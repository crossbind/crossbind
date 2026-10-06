const platformBuild = {
    'wasm': ['--enable-shared=no', '--host=wasm32-unknown-emscripten'],
    // Fake a known host to force cross mode; the wasi CC decides the real target.
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

// Library packages ship archives only: drop the bundled CLI (src) and its gnulib rider (srclib) on every platform.
const noCliReplaceList = [
    {
        regex: '\n\tcd srclib && \\$\\(MAKE\\) all',
        replacement: '',
        paths: ['Makefile.in'],
    },
    {
        regex: '\n\tcd src && \\$\\(MAKE\\) all',
        replacement: '',
        paths: ['Makefile.in'],
    },
    {
        regex: "\n\tcd srclib && \\$\\(MAKE\\) install prefix='\\$\\(prefix\\)' exec_prefix='\\$\\(exec_prefix\\)' libdir='\\$\\(libdir\\)'",
        replacement: '',
        paths: ['Makefile.in'],
    },
    {
        regex: "\n\tcd src && \\$\\(MAKE\\) install prefix='\\$\\(prefix\\)' exec_prefix='\\$\\(exec_prefix\\)' libdir='\\$\\(libdir\\)'",
        replacement: '',
        paths: ['Makefile.in'],
    },
];

export default {
    sha256: '88dd96a8c0464eca144fc791ae60cd31cd8ee78321e67397e25fc095c4a19aa6', // libiconv-1.19.tar.gz
    getURL: (version) => `https://ftp.gnu.org/pub/gnu/libiconv/libiconv-${version}.tar.gz`,
    sourceReplaceList: () => noCliReplaceList,
    buildType: 'configure',
    getBuildParams: (target) => [
        ...(platformBuild[target.platform] || platformBuild[`${target.platform}-${target.arch}`] || []),
        // The translations are the dropped CLI's, and the toolchain images have no msgfmt.
        '--disable-nls',
    ],
};

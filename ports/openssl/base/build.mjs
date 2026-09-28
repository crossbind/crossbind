// --libdir: the x86_64 Linux target would install into lib64, where no consumer looks.
const CONFIGURE_FLAGS = ['--cross-compile-prefix=', '--libdir=lib', 'no-apps', 'no-docs', 'no-tests', 'no-shared', 'threads'];
// The generic cc target builds without assembly; the desktop platforms have targets of their own that keep it.
const CONFIGURE_TARGETS = {
    darwin: { arm64: 'darwin64-arm64-cc', x64: 'darwin64-x86_64-cc' },
    linux: { arm64: 'linux-aarch64', x64: 'linux-x86_64-clang' },
    win32: { arm64: 'mingwarm64', x64: 'mingw64' },
};

// wasi: static single-threaded via the wasi-p3 target injected below; QUIC needs socketpair and wasi-libc's sockaddr_un has no sun_path.
const WASI_CONFIGURE_FLAGS = [
    'wasi-p3', 'no-asm', 'no-shared', 'no-threads', 'no-dso', 'no-ui-console',
    'no-tests', 'no-apps', 'no-docs', 'no-afalgeng', 'no-quic',
    '-DOPENSSL_NO_UNIX_SOCK',
];

export default {
    sha256: '736b467530f916737b7031310ccb21d8218c6229e61e8e160cd1d3458cd543a8', // openssl-4.0.2.tar.gz
    getURL: (version) => `https://github.com/openssl/openssl/releases/download/openssl-${version}/openssl-${version}.tar.gz`,
    buildType: 'configure',
    configureProgram: './Configure',
    // `make -j install` builds the library objects from two recursive makes at once and races on
    // their dependency files; build first, then install.
    makePhases: [['all'], ['install']],
    // Inert outside wasi: Configure reads it only when the wasi-p3 name is requested.
    copyToSource: { 'assets/90-wasi.conf': 'Configurations/90-wasi.conf' },
    getBuildParams: (target) => (target.platform === 'wasi'
        ? [...WASI_CONFIGURE_FLAGS]
        : [CONFIGURE_TARGETS[target.platform]?.[target.arch] ?? 'cc', ...CONFIGURE_FLAGS]),
    // -fPIC has no meaning for the static wasi archives; keep it off there.
    env: (target) => (target.platform === 'wasi' ? [] : ['CFLAGS="-fPIC"', 'CXXFLAGS="-fPIC"']),
    copyToDist: {
        'assets/cacert.pem': [
            'ssl/certs/cacert.pem',
        ],
    },
};

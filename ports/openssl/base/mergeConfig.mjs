import fs from 'node:fs';

// The CA certificates ship as data. curl has none built in on these platforms; GDAL and the curl tool find them
// through CURL_CA_BUNDLE.
const CERTS = { data: { 'ssl/certs': 'certs' }, env: { CURL_CA_BUNDLE: '_CROSSBIND_DATA_PATH_/certs/cacert.pem' } };

// OpenSSL's MinGW build lists the system libraries libcrypto needs in its pkg-config file, and a release may add one
// (4.1.0 added bcrypt): a Windows addon links what the win32 package's own build lists.
function windowsSystemLibs({ config, output = 'dist' } = {}) {
    const prebuilt = config && new URL(`${output}/prebuilt/`, config);
    if (!prebuilt || !fs.existsSync(prebuilt)) return [];
    const pc = fs.readdirSync(prebuilt)
        .filter((target) => target.startsWith('win32-'))
        .map((target) => new URL(`${target}/lib/pkgconfig/libcrypto.pc`, prebuilt))
        .find((file) => fs.existsSync(file));
    const libs = pc ? fs.readFileSync(pc, 'utf8').match(/^Libs\.private:(.*)$/m)?.[1] ?? '' : '';
    return libs.split(/\s+/).filter((flag) => flag.startsWith('-l'));
}

export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'openssl',
        alias: { package: '@crossbind/port-openssl' },
    },
    export: {
        type: 'cmake',
        publicHeaders: [
            'openssl/opensslv.h', 'openssl/crypto.h', 'openssl/err.h', 'openssl/evp.h', 'openssl/rand.h',
            'openssl/sha.h', 'openssl/hmac.h', 'openssl/bio.h', 'openssl/pem.h', 'openssl/x509.h',
            'openssl/ssl.h',
        ],
        libName: ['ssl', 'crypto'],
        // A pthread_once initializer is 0 where SWIG reads it and a struct on the platforms the bindings compile for.
        // Undefined for SWIG, CRYPTO_ONCE_STATIC_INIT names nothing it binds as a constant.
        swigPreamble: { 'openssl/crypto.h': ['#undef PTHREAD_ONCE_INIT'] },
        // SWIG reads the POSIX side of crypto.h, but on Windows a thread id is not a pthread_t and the fork hooks are absent.
        ignoredDeclarations: {
            'openssl/crypto.h': [
                'CRYPTO_THREAD_get_current_id', 'CRYPTO_THREAD_compare_id', 'OPENSSL_fork_prepare', 'OPENSSL_fork_parent',
                'OPENSSL_fork_child',
            ],
        },
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        { platform: 'android', specs: { libType: 'static', ...CERTS } },
        { platform: 'ios', specs: CERTS },
        { platform: 'darwin', specs: CERTS },
        { platform: 'linux', specs: CERTS },
        { platform: 'linuxmusl', specs: CERTS },
        { platform: 'win32', specs: { ...CERTS, binary: { addonFlags: windowsSystemLibs(newConfig.paths) } } },
        ...(newConfig.targetSpecs || []),
    ],
});

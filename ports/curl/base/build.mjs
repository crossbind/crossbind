const platformBuild = {
    'wasm': ['-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON'],
    'android': ['-DBUILD_SHARED_LIBS=ON', '-DBUILD_STATIC_LIBS=OFF'],
    // _CURL_PREFILL=ON loads unix-cache.cmake (HAVE_PIPE2=0); iPhoneSimulator SDK 26+ misdetects pipe2 otherwise.
    'ios': ['-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON', '-D_CURL_PREFILL=ON'],
    // The SDK is newer than the deployment target, so its declarations cannot tell what the oldest macOS has.
    // LDAP stays off as on every other platform, although the macOS SDK would provide it.
    'darwin': ['-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON', '-D_CURL_PREFILL=ON', '-DCURL_DISABLE_LDAP=ON'],
    'linux': ['-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON'],
    'linuxmusl': ['-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON'],
    // TLS through OpenSSL, as everywhere else, rather than Windows' own Schannel: curl leaves both
    // off on Windows unless asked. LDAP off as on every other platform, although Windows would
    // provide it.
    'win32': [
        '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON',
        '-DCURL_USE_SCHANNEL=OFF', '-DCURL_USE_OPENSSL=ON', '-DCURL_DISABLE_LDAP=ON',
    ],
    // wasi: HTTP(S)-only over wasi:sockets; no threads/socketpair/UNIX sockets; CA via CURLOPT_CAINFO.
    'wasi': [
        '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_STATIC_LIBS=ON',
        '-DHTTP_ONLY=ON',
        '-DENABLE_THREADED_RESOLVER=OFF',
        '-DCURL_DISABLE_SOCKETPAIR=ON',
        '-DENABLE_UNIX_SOCKETS=OFF',
        '-DCURL_CA_BUNDLE=none', '-DCURL_CA_PATH=none',
    ],
};

export default {
    sha256: 'd54dd598bf05927a726deb38df31c6a255ba83ff1de57c5d1464dac3ed8f44a1', // curl-8.22.0.tar.gz
    getURL: (version) => `https://curl.se/download/curl-${version}.tar.gz`,
    buildType: 'cmake',
    // The typed forms of variadic calls crossbind adds (see the header), shipped beside the upstream headers.
    copyToDist: {
        'node_modules/@crossbind/port-curl/include/curl/curl_crossbind.h': 'include/curl/curl_crossbind.h',
    },
    getBuildParams: (target, depPaths) => [
        ...(platformBuild[target.platform] || []),
        ...(depPaths.ssl && depPaths.crypto
            ? [
                `-DOPENSSL_INCLUDE_DIR=${depPaths.ssl.header}`,
                `-DOPENSSL_SSL_LIBRARY=${depPaths.ssl.lib}`,
                `-DOPENSSL_CRYPTO_LIBRARY=${depPaths.crypto.lib}`,
                // CMake's FindOpenSSL takes the MinGW libraries from these instead.
                ...(target.platform === 'win32' ? [`-DSSL_EAY=${depPaths.ssl.lib}`, `-DLIB_EAY=${depPaths.crypto.lib}`] : []),
            ]
            : []),
        '-DBUILD_EXAMPLES=OFF', '-DBUILD_CURL_EXE=OFF', '-DBUILD_LIBCURL_DOCS=OFF',
        '-DBUILD_TESTING=OFF',
        '-DENABLE_CURL_MANUAL=OFF',
        '-DENABLE_NETRC=OFF', '-DCURL_USE_LIBPSL=OFF', '-DENABLE_IPV6=OFF', '-DENABLE_NTLMWB=OFF',
    ],
};

export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'openssl',
        alias: { package: '@crossbind/port-openssl' },
    },
    export: {
        type: 'cmake',
        bundle: false,
        libName: ['ssl', 'crypto'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        { platform: 'android', specs: { libType: 'static', data: { 'ssl/certs': 'certs' } } },
        { platform: 'ios', specs: { data: { 'ssl/certs': 'certs' } } },
        { platform: 'darwin', specs: { data: { 'ssl/certs': 'certs' } } },
        { platform: 'linux', specs: { data: { 'ssl/certs': 'certs' } } },
        // The Winsock, GDI and CryptoAPI libraries OpenSSL's MinGW targets link.
        { platform: 'win32', specs: { data: { 'ssl/certs': 'certs' }, binary: { addonFlags: ['-lws2_32', '-lgdi32', '-lcrypt32'] } } },
        ...(newConfig.targetSpecs || []),
    ],
});

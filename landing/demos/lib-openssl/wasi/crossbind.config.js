import opensslWasi from '@crossbind/port-openssl-wasi/crossbind.config.js';

export default {
    general: { name: 'openssl-tool' },
    dependencies: [opensslWasi],
    // A separate output folder: crossbind 2.0.0-beta.60 stops with ENOENT at the end of a WASI build
    // whose dependencies ship data (OpenSSL's CA certificates here) when output is the build folder.
    paths: { config: import.meta.url, output: 'dist' },
};

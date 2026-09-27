import opensslWasm from '@crossbind/port-openssl-wasm/crossbind.config.js';

export default {
    general: { name: 'opensslapps' },
    dependencies: [opensslWasm],
    paths: { config: import.meta.url },
};

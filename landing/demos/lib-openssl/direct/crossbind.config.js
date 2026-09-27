import opensslWasm from '@crossbind/port-openssl-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'openssldirect' },
    dependencies: [opensslWasm],
    paths: { config: import.meta.url },
};

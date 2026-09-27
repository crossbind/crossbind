import zlibWasm from '@crossbind/port-zlib-wasm/crossbind.config.js';

export default {
    general: { name: 'zlibapps' },
    dependencies: [zlibWasm],
    paths: { config: import.meta.url },
};

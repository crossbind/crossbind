import expatWasm from '@crossbind/port-expat-wasm/crossbind.config.js';

export default {
    general: { name: 'expatapps' },
    dependencies: [expatWasm],
    paths: { config: import.meta.url },
};

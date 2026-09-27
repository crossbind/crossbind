import iconvWasm from '@crossbind/port-iconv-wasm/crossbind.config.js';

export default {
    general: { name: 'iconvapps' },
    dependencies: [iconvWasm],
    paths: { config: import.meta.url },
};

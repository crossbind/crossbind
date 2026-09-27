import webpWasm from '@crossbind/port-webp-wasm/crossbind.config.js';

export default {
    general: { name: 'webpapps' },
    dependencies: [webpWasm],
    paths: { config: import.meta.url },
};

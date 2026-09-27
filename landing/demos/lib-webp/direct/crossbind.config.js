import webpWasm from '@crossbind/port-webp-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'webpdirect' },
    dependencies: [webpWasm],
    paths: { config: import.meta.url },
};

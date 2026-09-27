import iconvWasm from '@crossbind/port-iconv-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'iconvdirect' },
    dependencies: [iconvWasm],
    paths: { config: import.meta.url },
};

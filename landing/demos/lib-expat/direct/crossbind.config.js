import expatWasm from '@crossbind/port-expat-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'expatdirect' },
    dependencies: [expatWasm],
    paths: { config: import.meta.url },
};

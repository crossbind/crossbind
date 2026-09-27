import zlibWasm from '@crossbind/port-zlib-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'zlibdirect' },
    dependencies: [zlibWasm],
    paths: { config: import.meta.url },
};

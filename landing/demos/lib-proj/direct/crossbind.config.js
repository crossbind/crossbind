import projWasm from '@crossbind/port-proj-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'projdirect' },
    dependencies: [projWasm],
    paths: { config: import.meta.url },
};

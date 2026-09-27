import lercWasm from '@crossbind/port-lerc-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'lercdirect' },
    dependencies: [lercWasm],
    paths: { config: import.meta.url },
};

import zstdWasm from '@crossbind/port-zstd-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'zstddirect' },
    dependencies: [zstdWasm],
    paths: { config: import.meta.url },
};

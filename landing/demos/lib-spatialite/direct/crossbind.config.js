import spatialiteWasm from '@crossbind/port-spatialite-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'spatialitedirect' },
    dependencies: [spatialiteWasm],
    paths: { config: import.meta.url },
};

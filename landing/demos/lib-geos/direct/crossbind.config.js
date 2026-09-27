import geosWasm from '@crossbind/port-geos-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'geosdirect' },
    dependencies: [geosWasm],
    paths: { config: import.meta.url },
};

import geosWasm from '@crossbind/port-geos-wasm/crossbind.config.js';

export default {
    general: { name: 'geosapps' },
    dependencies: [geosWasm],
    paths: { config: import.meta.url },
};

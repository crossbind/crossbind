import spatialiteWasm from '@crossbind/port-spatialite-wasm/crossbind.config.js';

export default {
    general: { name: 'spatialiteapps' },
    dependencies: [spatialiteWasm],
    paths: { config: import.meta.url },
};

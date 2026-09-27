import geotiffWasm from '@crossbind/port-geotiff-wasm/crossbind.config.js';

export default {
    general: { name: 'geotiffapps' },
    dependencies: [geotiffWasm],
    paths: { config: import.meta.url },
};

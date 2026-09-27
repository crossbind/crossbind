import geotiffWasm from '@crossbind/port-geotiff-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'geotiffdirect' },
    dependencies: [geotiffWasm],
    paths: { config: import.meta.url },
};

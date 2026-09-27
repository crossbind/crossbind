import tiffWasm from '@crossbind/port-tiff-wasm/crossbind.config.js';

export default {
    general: { name: 'tiffapps' },
    dependencies: [tiffWasm],
    paths: { config: import.meta.url },
};

import jpegturboWasm from '@crossbind/port-jpegturbo-wasm/crossbind.config.js';

export default {
    general: { name: 'jpegapps' },
    dependencies: [jpegturboWasm],
    paths: { config: import.meta.url },
};

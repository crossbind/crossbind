import lercWasm from '@crossbind/port-lerc-wasm/crossbind.config.js';

export default {
    general: { name: 'lercapps' },
    dependencies: [lercWasm],
    paths: { config: import.meta.url },
};

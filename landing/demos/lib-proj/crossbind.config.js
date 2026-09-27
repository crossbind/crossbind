import projWasm from '@crossbind/port-proj-wasm/crossbind.config.js';

export default {
    general: { name: 'projapps' },
    dependencies: [projWasm],
    paths: { config: import.meta.url },
};

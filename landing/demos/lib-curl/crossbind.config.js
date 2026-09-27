import curlWasm from '@crossbind/port-curl-wasm/crossbind.config.js';

export default {
    general: { name: 'curlapps' },
    dependencies: [curlWasm],
    paths: { config: import.meta.url },
};

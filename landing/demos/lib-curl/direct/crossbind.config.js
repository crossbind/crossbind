import curlWasm from '@crossbind/port-curl-wasm/crossbind.config.js';

// No C++ in this project: every binding comes from the port headers the JavaScript imports.
export default {
    general: { name: 'curldirect' },
    dependencies: [curlWasm],
    paths: { config: import.meta.url },
};

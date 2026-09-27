import zstdWasm from '@crossbind/port-zstd-wasm/crossbind.config.js';

export default {
    general: { name: 'zstdapps' },
    dependencies: [zstdWasm],
    paths: { config: import.meta.url },
};

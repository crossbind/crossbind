import zstdWasi from '@crossbind/port-zstd-wasi/crossbind.config.js';

export default {
    general: { name: 'zstd-tool' },
    dependencies: [zstdWasi],
    paths: { config: import.meta.url },
};

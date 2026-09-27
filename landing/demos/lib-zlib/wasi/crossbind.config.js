import zlibWasi from '@crossbind/port-zlib-wasi/crossbind.config.js';

export default {
    general: { name: 'zlib-tool' },
    dependencies: [zlibWasi],
    paths: { config: import.meta.url },
};

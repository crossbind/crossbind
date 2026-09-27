import iconvWasi from '@crossbind/port-iconv-wasi/crossbind.config.js';

export default {
    general: { name: 'iconv-tool' },
    dependencies: [iconvWasi],
    paths: { config: import.meta.url },
};

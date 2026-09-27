import webpWasi from '@crossbind/port-webp-wasi/crossbind.config.js';

export default {
    general: { name: 'webp-tool' },
    dependencies: [webpWasi],
    paths: { config: import.meta.url },
};

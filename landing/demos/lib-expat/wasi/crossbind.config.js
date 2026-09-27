import expatWasi from '@crossbind/port-expat-wasi/crossbind.config.js';

export default {
    general: { name: 'xml-stats' },
    dependencies: [expatWasi],
    paths: { config: import.meta.url },
};

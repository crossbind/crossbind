import lercWasi from '@crossbind/port-lerc-wasi/crossbind.config.js';

export default {
    general: { name: 'lerc-tool' },
    dependencies: [lercWasi],
    paths: { config: import.meta.url },
};

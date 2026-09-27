import geosWasi from '@crossbind/port-geos-wasi/crossbind.config.js';

export default {
    general: { name: 'geos-tool' },
    dependencies: [geosWasi],
    paths: { config: import.meta.url },
};

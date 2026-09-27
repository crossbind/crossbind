import spatialiteWasi from '@crossbind/port-spatialite-wasi/crossbind.config.js';

export default {
    general: { name: 'spatialite-tool' },
    dependencies: [spatialiteWasi],
    // The program and PROJ's data folder land in dist/, next to each other.
    paths: { config: import.meta.url, output: 'dist' },
};

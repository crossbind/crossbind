import geotiffWasi from '@crossbind/port-geotiff-wasi/crossbind.config.js';

export default {
    general: { name: 'geotiff-tool' },
    dependencies: [geotiffWasi],
    // PROJ's data folder is copied from the build directory to dist/data, so the two must differ.
    paths: { config: import.meta.url, output: 'dist' },
};

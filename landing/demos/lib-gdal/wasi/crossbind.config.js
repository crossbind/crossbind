import gdalWasi from '@crossbind/port-gdal-wasi/crossbind.config.js';

export default {
    general: { name: 'gdal-tool' },
    dependencies: [gdalWasi],
    // The program and the GDAL and PROJ data it reads land in dist/.
    paths: { config: import.meta.url, output: 'dist' },
};

import mergeConfig from '@crossbind/port-geotiff/mergeConfig.mjs';
import projDarwin from '@crossbind/port-proj-darwin/crossbind.config.js';
import tiffDarwin from '@crossbind/port-tiff-darwin/crossbind.config.js';
import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import jpegturboDarwin from '@crossbind/port-jpegturbo-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [projDarwin, tiffDarwin, zlibDarwin, jpegturboDarwin],
    paths: { config: import.meta.url },
});

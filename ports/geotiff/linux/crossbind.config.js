import mergeConfig from '@crossbind/port-geotiff/mergeConfig.mjs';
import projLinux from '@crossbind/port-proj-linux/crossbind.config.js';
import tiffLinux from '@crossbind/port-tiff-linux/crossbind.config.js';
import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';
import jpegturboLinux from '@crossbind/port-jpegturbo-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [projLinux, tiffLinux, zlibLinux, jpegturboLinux],
    paths: { config: import.meta.url },
});

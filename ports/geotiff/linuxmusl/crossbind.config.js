import mergeConfig from '@crossbind/port-geotiff/mergeConfig.mjs';
import projLinuxmusl from '@crossbind/port-proj-linuxmusl/crossbind.config.js';
import tiffLinuxmusl from '@crossbind/port-tiff-linuxmusl/crossbind.config.js';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import jpegturboLinuxmusl from '@crossbind/port-jpegturbo-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [projLinuxmusl, tiffLinuxmusl, zlibLinuxmusl, jpegturboLinuxmusl],
    paths: { config: import.meta.url },
});

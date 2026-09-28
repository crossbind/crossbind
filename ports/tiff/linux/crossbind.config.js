import mergeConfig from '@crossbind/port-tiff/mergeConfig.mjs';
import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';
import jpegturboLinux from '@crossbind/port-jpegturbo-linux/crossbind.config.js';
import zstdLinux from '@crossbind/port-zstd-linux/crossbind.config.js';
import lercLinux from '@crossbind/port-lerc-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [zlibLinux, jpegturboLinux, zstdLinux, lercLinux],
    paths: { config: import.meta.url },
});

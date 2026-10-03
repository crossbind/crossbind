import mergeConfig from '@crossbind/port-tiff/mergeConfig.mjs';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import jpegturboLinuxmusl from '@crossbind/port-jpegturbo-linuxmusl/crossbind.config.js';
import zstdLinuxmusl from '@crossbind/port-zstd-linuxmusl/crossbind.config.js';
import lercLinuxmusl from '@crossbind/port-lerc-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [zlibLinuxmusl, jpegturboLinuxmusl, zstdLinuxmusl, lercLinuxmusl],
    paths: { config: import.meta.url },
});

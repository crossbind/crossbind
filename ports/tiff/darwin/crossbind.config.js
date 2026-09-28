import mergeConfig from '@crossbind/port-tiff/mergeConfig.mjs';
import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import jpegturboDarwin from '@crossbind/port-jpegturbo-darwin/crossbind.config.js';
import zstdDarwin from '@crossbind/port-zstd-darwin/crossbind.config.js';
import lercDarwin from '@crossbind/port-lerc-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [zlibDarwin, jpegturboDarwin, zstdDarwin, lercDarwin],
    paths: { config: import.meta.url },
});

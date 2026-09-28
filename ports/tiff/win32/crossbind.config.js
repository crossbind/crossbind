import mergeConfig from '@crossbind/port-tiff/mergeConfig.mjs';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';
import jpegturboWin32 from '@crossbind/port-jpegturbo-win32/crossbind.config.js';
import zstdWin32 from '@crossbind/port-zstd-win32/crossbind.config.js';
import lercWin32 from '@crossbind/port-lerc-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [zlibWin32, jpegturboWin32, zstdWin32, lercWin32],
    paths: { config: import.meta.url },
});

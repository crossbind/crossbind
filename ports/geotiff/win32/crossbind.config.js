import mergeConfig from '@crossbind/port-geotiff/mergeConfig.mjs';
import projWin32 from '@crossbind/port-proj-win32/crossbind.config.js';
import tiffWin32 from '@crossbind/port-tiff-win32/crossbind.config.js';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';
import jpegturboWin32 from '@crossbind/port-jpegturbo-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [projWin32, tiffWin32, zlibWin32, jpegturboWin32],
    paths: { config: import.meta.url },
});

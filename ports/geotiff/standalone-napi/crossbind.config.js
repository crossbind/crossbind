import darwin from '@crossbind/port-geotiff-darwin/crossbind.config.js';
import linux from '@crossbind/port-geotiff-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-geotiff-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-geotiff-win32/crossbind.config.js';

export default {
    general: { name: 'geotiff-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        // A GeoTIFF is written and read through libtiff's own calls.
        bindings: { headers: ['@crossbind/port-geotiff', '@crossbind/port-tiff'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

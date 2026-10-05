import darwin from '@crossbind/port-gdal-darwin/crossbind.config.js';
import linux from '@crossbind/port-gdal-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-gdal-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-gdal-win32/crossbind.config.js';

export default {
    general: { name: 'gdal-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-gdal'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

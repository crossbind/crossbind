import darwin from '@crossbind/port-tiff-darwin/crossbind.config.js';
import linux from '@crossbind/port-tiff-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-tiff-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-tiff-win32/crossbind.config.js';

export default {
    general: { name: 'tiff-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-tiff'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

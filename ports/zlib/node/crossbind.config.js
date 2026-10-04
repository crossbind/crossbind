import darwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import linux from '@crossbind/port-zlib-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-zlib-win32/crossbind.config.js';

export default {
    general: { name: 'zlib-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-zlib'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

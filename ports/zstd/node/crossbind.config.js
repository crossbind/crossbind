import darwin from '@crossbind/port-zstd-darwin/crossbind.config.js';
import linux from '@crossbind/port-zstd-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-zstd-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-zstd-win32/crossbind.config.js';

export default {
    general: { name: 'zstd-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-zstd'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

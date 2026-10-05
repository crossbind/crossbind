import darwin from '@crossbind/port-webp-darwin/crossbind.config.js';
import linux from '@crossbind/port-webp-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-webp-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-webp-win32/crossbind.config.js';

export default {
    general: { name: 'webp-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-webp'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

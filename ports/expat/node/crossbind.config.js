import darwin from '@crossbind/port-expat-darwin/crossbind.config.js';
import linux from '@crossbind/port-expat-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-expat-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-expat-win32/crossbind.config.js';

export default {
    general: { name: 'expat-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-expat'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

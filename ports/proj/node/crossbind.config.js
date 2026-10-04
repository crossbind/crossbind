import darwin from '@crossbind/port-proj-darwin/crossbind.config.js';
import linux from '@crossbind/port-proj-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-proj-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-proj-win32/crossbind.config.js';

export default {
    general: { name: 'proj-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-proj'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

import darwin from '@crossbind/port-sqlite3-darwin/crossbind.config.js';
import linux from '@crossbind/port-sqlite3-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-sqlite3-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-sqlite3-win32/crossbind.config.js';

export default {
    general: { name: 'sqlite3-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-sqlite3'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

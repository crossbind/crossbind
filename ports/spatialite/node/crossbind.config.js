import darwin from '@crossbind/port-spatialite-darwin/crossbind.config.js';
import linux from '@crossbind/port-spatialite-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-spatialite-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-spatialite-win32/crossbind.config.js';

export default {
    general: { name: 'spatialite-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        // A spatialite connection is a sqlite3 one, opened and queried through sqlite3's own API.
        bindings: { headers: ['@crossbind/port-spatialite', '@crossbind/port-sqlite3'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

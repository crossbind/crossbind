import darwin from '@crossbind/port-geos-darwin/crossbind.config.js';
import linux from '@crossbind/port-geos-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-geos-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-geos-win32/crossbind.config.js';

export default {
    general: { name: 'geos-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-geos'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

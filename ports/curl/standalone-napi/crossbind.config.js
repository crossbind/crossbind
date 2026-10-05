import darwin from '@crossbind/port-curl-darwin/crossbind.config.js';
import linux from '@crossbind/port-curl-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-curl-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-curl-win32/crossbind.config.js';

export default {
    general: { name: 'curl-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-curl'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

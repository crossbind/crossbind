import darwin from '@crossbind/port-openssl-darwin/crossbind.config.js';
import linux from '@crossbind/port-openssl-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-openssl-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-openssl-win32/crossbind.config.js';

export default {
    general: { name: 'openssl-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-openssl'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

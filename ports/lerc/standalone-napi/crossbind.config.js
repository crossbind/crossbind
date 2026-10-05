import darwin from '@crossbind/port-lerc-darwin/crossbind.config.js';
import linux from '@crossbind/port-lerc-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-lerc-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-lerc-win32/crossbind.config.js';

export default {
    general: { name: 'lerc-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-lerc'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

import darwin from '@crossbind/port-iconv-darwin/crossbind.config.js';
import linux from '@crossbind/port-iconv-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-iconv-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-iconv-win32/crossbind.config.js';

export default {
    general: { name: 'iconv-standalone-napi' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-iconv'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

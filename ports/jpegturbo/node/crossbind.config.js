import darwin from '@crossbind/port-jpegturbo-darwin/crossbind.config.js';
import linux from '@crossbind/port-jpegturbo-linux/crossbind.config.js';
import linuxmusl from '@crossbind/port-jpegturbo-linuxmusl/crossbind.config.js';
import win32 from '@crossbind/port-jpegturbo-win32/crossbind.config.js';

export default {
    general: { name: 'jpegturbo-node' },
    dependencies: [darwin, linux, linuxmusl, win32],
    export: {
        bindings: { headers: ['@crossbind/port-jpegturbo'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};

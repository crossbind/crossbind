import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';

export default {
    general: {
        name: 'crossbind-e2e-cli-native',
    },
    dependencies: [zlibLinux, zlibLinuxmusl, zlibWin32, zlibDarwin],
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
};

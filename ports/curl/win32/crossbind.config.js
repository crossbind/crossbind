import mergeConfig from '@crossbind/port-curl/mergeConfig.mjs';
import opensslWin32 from '@crossbind/port-openssl-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [opensslWin32],
    paths: { config: import.meta.url },
});

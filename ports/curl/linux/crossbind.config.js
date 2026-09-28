import mergeConfig from '@crossbind/port-curl/mergeConfig.mjs';
import opensslLinux from '@crossbind/port-openssl-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [opensslLinux],
    paths: { config: import.meta.url },
});

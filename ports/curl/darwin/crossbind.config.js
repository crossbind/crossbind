import mergeConfig from '@crossbind/port-curl/mergeConfig.mjs';
import opensslDarwin from '@crossbind/port-openssl-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [opensslDarwin],
    paths: { config: import.meta.url },
});

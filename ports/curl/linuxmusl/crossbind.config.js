import mergeConfig from '@crossbind/port-curl/mergeConfig.mjs';
import opensslLinuxmusl from '@crossbind/port-openssl-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [opensslLinuxmusl],
    paths: { config: import.meta.url },
});

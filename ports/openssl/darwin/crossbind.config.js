import mergeConfig from '@crossbind/port-openssl/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

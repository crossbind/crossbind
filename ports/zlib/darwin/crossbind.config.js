import mergeConfig from '@crossbind/port-zlib/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

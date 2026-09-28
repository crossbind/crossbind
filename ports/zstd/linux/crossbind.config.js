import mergeConfig from '@crossbind/port-zstd/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

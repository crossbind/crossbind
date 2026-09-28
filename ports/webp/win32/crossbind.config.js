import mergeConfig from '@crossbind/port-webp/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

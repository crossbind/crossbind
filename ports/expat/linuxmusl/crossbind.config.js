import mergeConfig from '@crossbind/port-expat/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

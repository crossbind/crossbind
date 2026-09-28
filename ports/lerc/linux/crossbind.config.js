import mergeConfig from '@crossbind/port-lerc/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

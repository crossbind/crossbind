import mergeConfig from '@crossbind/port-geos/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

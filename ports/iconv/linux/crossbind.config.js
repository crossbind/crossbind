import mergeConfig from '@crossbind/port-iconv/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

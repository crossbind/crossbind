import mergeConfig from '@crossbind/port-jpegturbo/mergeConfig.mjs';

export default mergeConfig({
    paths: { config: import.meta.url },
});

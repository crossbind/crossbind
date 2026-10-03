import mergeConfig from '@crossbind/port-sqlite3/mergeConfig.mjs';

export default mergeConfig({
    dependencies: [],
    paths: { config: import.meta.url },
});

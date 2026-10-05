import mergeConfig from '@crossbind/port-sqlite3/mergeConfig.mjs';
import wasiVariant from '@crossbind/port-sqlite3-wasi/crossbind.config.js';

// Same dependency set as the -wasi library variant; only the recipe (crossbind.build.js) differs.
export default mergeConfig({
    dependencies: wasiVariant.dependencies || [],
    paths: { config: import.meta.url },
});

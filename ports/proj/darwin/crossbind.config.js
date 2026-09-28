import mergeConfig from '@crossbind/port-proj/mergeConfig.mjs';
import tiffDarwin from '@crossbind/port-tiff-darwin/crossbind.config.js';
import sqlite3Darwin from '@crossbind/port-sqlite3-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [tiffDarwin, sqlite3Darwin],
    paths: { config: import.meta.url },
});

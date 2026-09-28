import mergeConfig from '@crossbind/port-proj/mergeConfig.mjs';
import tiffLinux from '@crossbind/port-tiff-linux/crossbind.config.js';
import sqlite3Linux from '@crossbind/port-sqlite3-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [tiffLinux, sqlite3Linux],
    paths: { config: import.meta.url },
});

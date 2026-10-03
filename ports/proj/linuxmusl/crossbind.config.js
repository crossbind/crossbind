import mergeConfig from '@crossbind/port-proj/mergeConfig.mjs';
import tiffLinuxmusl from '@crossbind/port-tiff-linuxmusl/crossbind.config.js';
import sqlite3Linuxmusl from '@crossbind/port-sqlite3-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [tiffLinuxmusl, sqlite3Linuxmusl],
    paths: { config: import.meta.url },
});

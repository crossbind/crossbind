import mergeConfig from '@crossbind/port-spatialite/mergeConfig.mjs';
import geosLinux from '@crossbind/port-geos-linux/crossbind.config.js';
import projLinux from '@crossbind/port-proj-linux/crossbind.config.js';
import sqlite3Linux from '@crossbind/port-sqlite3-linux/crossbind.config.js';
import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';
import iconvLinux from '@crossbind/port-iconv-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [geosLinux, projLinux, sqlite3Linux, zlibLinux, iconvLinux],
    paths: { config: import.meta.url },
});

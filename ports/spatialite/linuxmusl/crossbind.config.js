import mergeConfig from '@crossbind/port-spatialite/mergeConfig.mjs';
import geosLinuxmusl from '@crossbind/port-geos-linuxmusl/crossbind.config.js';
import projLinuxmusl from '@crossbind/port-proj-linuxmusl/crossbind.config.js';
import sqlite3Linuxmusl from '@crossbind/port-sqlite3-linuxmusl/crossbind.config.js';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import iconvLinuxmusl from '@crossbind/port-iconv-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [geosLinuxmusl, projLinuxmusl, sqlite3Linuxmusl, zlibLinuxmusl, iconvLinuxmusl],
    paths: { config: import.meta.url },
});

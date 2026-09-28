import mergeConfig from '@crossbind/port-spatialite/mergeConfig.mjs';
import geosDarwin from '@crossbind/port-geos-darwin/crossbind.config.js';
import projDarwin from '@crossbind/port-proj-darwin/crossbind.config.js';
import sqlite3Darwin from '@crossbind/port-sqlite3-darwin/crossbind.config.js';
import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import iconvDarwin from '@crossbind/port-iconv-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [geosDarwin, projDarwin, sqlite3Darwin, zlibDarwin, iconvDarwin],
    paths: { config: import.meta.url },
});

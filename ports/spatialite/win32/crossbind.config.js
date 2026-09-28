import mergeConfig from '@crossbind/port-spatialite/mergeConfig.mjs';
import geosWin32 from '@crossbind/port-geos-win32/crossbind.config.js';
import projWin32 from '@crossbind/port-proj-win32/crossbind.config.js';
import sqlite3Win32 from '@crossbind/port-sqlite3-win32/crossbind.config.js';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';
import iconvWin32 from '@crossbind/port-iconv-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [geosWin32, projWin32, sqlite3Win32, zlibWin32, iconvWin32],
    paths: { config: import.meta.url },
});

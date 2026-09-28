import mergeConfig from '@crossbind/port-proj/mergeConfig.mjs';
import tiffWin32 from '@crossbind/port-tiff-win32/crossbind.config.js';
import sqlite3Win32 from '@crossbind/port-sqlite3-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [tiffWin32, sqlite3Win32],
    paths: { config: import.meta.url },
});

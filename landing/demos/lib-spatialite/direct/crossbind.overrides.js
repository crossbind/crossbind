import spatialiteWasm from '@crossbind/port-spatialite-wasm/crossbind.config.js';
import sqlite3Wasm from '@crossbind/port-sqlite3-wasm/crossbind.config.js';

// Importing sqlite3.h and spatialite.h binds every function they declare, and these
// are not in the published libraries: sqlite3_mutex_held and sqlite3_mutex_notheld
// exist only without NDEBUG, the other sqlite3 ones only on Windows or behind
// SQLITE_ENABLE_* options, load_zip_* and load_XL only with minizip and FreeXL, and
// spatialite_set_verbode_mode is a misspelling the library never defines.
// The lists live here, not on the dependencies in crossbind.config.js, because sqlite3
// also comes in through SpatiaLite and PROJ and those copies win over one listed there.
// A `replace` reaches every copy and hands each package back with
// export.ignoredDeclarations added, so nothing is rebuilt.
const ignore = (config, names) => ({
    replace: { ...config, export: { ...config.export, ignoredDeclarations: names } },
});

export default {
    '@crossbind/port-sqlite3-wasm': ignore(sqlite3Wasm, [
        'sqlite3_mutex_held',
        'sqlite3_mutex_notheld',
        'sqlite3_win32_set_directory',
        'sqlite3_win32_set_directory8',
        'sqlite3_win32_set_directory16',
        'sqlite3_unlock_notify',
        'sqlite3_stmt_scanstatus',
        'sqlite3_stmt_scanstatus_v2',
        'sqlite3_stmt_scanstatus_reset',
        'sqlite3_snapshot_get',
        'sqlite3_snapshot_open',
        'sqlite3_snapshot_free',
        'sqlite3_snapshot_cmp',
        'sqlite3_snapshot_recover',
        'sqlite3_carray_bind',
        'sqlite3_carray_bind_v2',
    ]),
    '@crossbind/port-spatialite-wasm': ignore(spatialiteWasm, [
        'spatialite_set_verbode_mode',
        'load_zip_shapefile',
        'load_zip_dbf',
        'load_XL',
    ]),
};

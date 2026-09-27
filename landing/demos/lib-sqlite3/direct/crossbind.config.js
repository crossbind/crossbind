import sqlite3Wasm from '@crossbind/port-sqlite3-wasm/crossbind.config.js';

// sqlite3.h declares functions this build of SQLite does not have: two exist only
// without NDEBUG (SWIG reads the header without it, the release compile defines it),
// the others are Windows-only or need compile options the port leaves off. Ignoring
// them lets the header's bindings compile and link.
const NOT_IN_THIS_BUILD = [
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
];

// No C++ in this project: every binding comes from the port headers the JavaScript
// imports.
export default {
    general: { name: 'sqlite3direct' },
    dependencies: [
        {
            ...sqlite3Wasm,
            export: { ...sqlite3Wasm.export, ignoredDeclarations: NOT_IN_THIS_BUILD },
        },
    ],
    paths: { config: import.meta.url },
};

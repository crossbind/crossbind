export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'sqlite3',
        alias: { package: '@crossbind/port-sqlite3' },
    },
    export: {
        type: 'cmake',
        // Declared in sqlite3.h but not in this build of the library, so bindings of the header
        // would not link: debug-only mutex checks, Windows-only calls, and features behind
        // SQLITE_ENABLE_* options the port leaves off.
        ignoredDeclarations: [
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
        ],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});

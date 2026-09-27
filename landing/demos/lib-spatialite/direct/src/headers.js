// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    spatialite_alloc_connection,
    spatialite_cleanup_ex,
    spatialite_init_ex,
    spatialite_version,
} from '@crossbind/port-spatialite/spatialite.h';
export {
    sqlite3_bind_double,
    sqlite3_bind_int,
    sqlite3_bind_text,
    sqlite3_changes,
    sqlite3_close,
    sqlite3_column_double,
    sqlite3_column_text,
    sqlite3_column_type,
    sqlite3_errmsg,
    sqlite3_exec,
    sqlite3_finalize,
    sqlite3_open,
    sqlite3_prepare_v2,
    sqlite3_reset,
    sqlite3_step,
    allocPointer,
    readCString,
    readPointerAt,
    writeNumberAt,
} from '@crossbind/port-sqlite3/sqlite3.h';

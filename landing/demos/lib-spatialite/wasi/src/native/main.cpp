// A command-line spatial SQL runner for WASI:
//   spatialite-tool <database> "<sql>"   runs the SQL against the database file
//   spatialite-tool <database>           reads the SQL from standard input
// SpatiaLite's functions are registered on the connection, so the SQL can create geometry columns,
// measure and transform. Rows print as the sqlite3 shell prints them, columns joined by |, with any
// geometry written as WKT, and a summary line follows. ST_Transform needs PROJ's proj.db: point
// PROJ_DATA at the folder the build writes to .crossbind/build/data/proj.
#include <sqlite3.h>
#include <spatialite.h>

#include <cstdio>
#include <string>
#include <vector>

// The WASI build of SQLite leaves extension loading out, but SpatiaLite calls
// sqlite3_enable_load_extension when it opens a connection of its own, so the link needs a
// definition. Nothing can be loaded here, and SpatiaLite ignores the answer.
extern "C" int sqlite3_enable_load_extension(sqlite3*, int) { return SQLITE_ERROR; }

namespace {

std::string readAll(FILE* file) {
    std::string text;
    std::vector<char> buffer(64 * 1024);
    size_t read = 0;
    while ((read = std::fread(buffer.data(), 1, buffer.size(), file)) > 0) text.append(buffer.data(), read);
    return text;
}

// A cell as text; a blob that holds a SpatiaLite geometry prints as its WKT.
std::string cell(sqlite3_stmt* statement, int column, sqlite3_stmt* wkt) {
    if (sqlite3_column_type(statement, column) == SQLITE_BLOB) {
        sqlite3_reset(wkt);
        sqlite3_bind_blob(wkt, 1, sqlite3_column_blob(statement, column), sqlite3_column_bytes(statement, column), SQLITE_TRANSIENT);
        if (sqlite3_step(wkt) == SQLITE_ROW && sqlite3_column_type(wkt, 0) != SQLITE_NULL) return reinterpret_cast<const char*>(sqlite3_column_text(wkt, 0));
    }
    const unsigned char* text = sqlite3_column_text(statement, column);
    return text ? reinterpret_cast<const char*>(text) : "";
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3) {
        std::fprintf(stderr, "usage: spatialite-tool <database> [sql]   (without sql, reads it from standard input)\n");
        return 2;
    }
    const std::string sql = argc == 3 ? argv[2] : readAll(stdin);
    sqlite3* db = nullptr;
    if (sqlite3_open(argv[1], &db) != SQLITE_OK) {
        std::fprintf(stderr, "%s: %s\n", argv[1], sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }
    void* cache = spatialite_alloc_connection();
    spatialite_init_ex(db, cache, 0);
    sqlite3_stmt* wkt = nullptr;
    sqlite3_prepare_v2(db, "SELECT AsText(?1)", -1, &wkt, nullptr);
    int statements = 0;
    int status = 0;
    const char* rest = sql.c_str();
    const char* end = rest + sql.size();
    while (rest < end && status == 0) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, rest, static_cast<int>(end - rest), &statement, &rest) != SQLITE_OK) {
            std::fprintf(stderr, "sql: %s\n", sqlite3_errmsg(db));
            status = 1;
            break;
        }
        if (!statement) continue;
        statements += 1;
        int result;
        while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
            for (int column = 0; column < sqlite3_column_count(statement); column += 1) {
                std::printf("%s%s", column ? "|" : "", cell(statement, column, wkt).c_str());
            }
            std::printf("\n");
        }
        if (result != SQLITE_DONE) {
            std::fprintf(stderr, "sql: %s\n", sqlite3_errmsg(db));
            status = 1;
        }
        sqlite3_finalize(statement);
    }
    if (status == 0) {
        std::printf("spatialite %s, %s: %d statement%s, %d rows changed\n", spatialite_version(), argv[1], statements, statements == 1 ? "" : "s",
                    sqlite3_total_changes(db));
    }
    sqlite3_finalize(wkt);
    sqlite3_close(db);
    spatialite_cleanup_ex(cache);
    return status;
}

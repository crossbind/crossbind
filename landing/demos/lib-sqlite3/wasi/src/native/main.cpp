// A command-line SQL runner for WASI:
//   sqlite-tool <database> "<sql>"   runs the SQL against the database file
//   sqlite-tool <database>           reads the SQL from standard input
// Result rows print as the sqlite3 shell prints them by default, columns joined by |, and a
// summary line follows.
#include <sqlite3.h>

#include <cstdio>
#include <string>
#include <vector>

namespace {

std::string readAll(FILE* file) {
    std::string text;
    std::vector<char> buffer(64 * 1024);
    size_t read = 0;
    while ((read = std::fread(buffer.data(), 1, buffer.size(), file)) > 0) text.append(buffer.data(), read);
    return text;
}

int fail(sqlite3* db, const char* what) {
    std::fprintf(stderr, "%s: %s\n", what, sqlite3_errmsg(db));
    sqlite3_close(db);
    return 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3) {
        std::fprintf(stderr, "usage: sqlite-tool <database> [sql]   (without sql, reads it from standard input)\n");
        return 2;
    }
    const std::string sql = argc == 3 ? argv[2] : readAll(stdin);
    sqlite3* db = nullptr;
    if (sqlite3_open(argv[1], &db) != SQLITE_OK) return fail(db, argv[1]);
    int statements = 0;
    const char* rest = sql.c_str();
    const char* end = rest + sql.size();
    while (rest < end) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, rest, static_cast<int>(end - rest), &statement, &rest) != SQLITE_OK) return fail(db, "sql");
        if (!statement) continue;
        statements += 1;
        int result;
        while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
            for (int column = 0; column < sqlite3_column_count(statement); column += 1) {
                const unsigned char* text = sqlite3_column_text(statement, column);
                std::printf("%s%s", column ? "|" : "", text ? reinterpret_cast<const char*>(text) : "");
            }
            std::printf("\n");
        }
        if (result != SQLITE_DONE) {
            std::fprintf(stderr, "sql: %s\n", sqlite3_errmsg(db));
            sqlite3_finalize(statement);
            sqlite3_close(db);
            return 1;
        }
        sqlite3_finalize(statement);
    }
    std::printf("sqlite %s, %s: %d statement%s, %d rows changed\n", sqlite3_libversion(), argv[1], statements, statements == 1 ? "" : "s",
                sqlite3_total_changes(db));
    sqlite3_close(db);
    return 0;
}

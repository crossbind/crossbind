#pragma once

#include <sqlite3.h>
#include <stdexcept>
#include <string>

// SQLite's C API behind a class: an error is an exception.
class Database {
public:
    Database() { sqlite3_open(":memory:", &db); }
    ~Database() { sqlite3_close(db); }
    int run(const std::string &sql) {
        const int code = sqlite3_exec(db, sql.c_str(), 0, 0, 0);
        if (code) throw std::runtime_error(sqlite3_errmsg(db));
        return sqlite3_changes(db);
    }

private:
    sqlite3 *db = nullptr;
};

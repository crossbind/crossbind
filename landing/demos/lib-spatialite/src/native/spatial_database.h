#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <stdexcept>
#include <string>

// An in-memory SQLite database with SpatiaLite's spatial SQL functions registered on it.
class SpatialDatabase {
public:
    SpatialDatabase() {
        if (sqlite3_open(":memory:", &handle) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(handle, cache, 0);
    }

    ~SpatialDatabase() {
        sqlite3_close(handle);
        spatialite_cleanup_ex(cache);
    }

    static std::string version() { return spatialite_version(); }

    void exec(const std::string& sql) {
        char* message = nullptr;
        if (sqlite3_exec(handle, sql.c_str(), nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : sqlite3_errmsg(handle);
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    // The first column of the first row as text, or "" when the query returns no row.
    std::string scalar(const std::string& sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(handle, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(handle));
        const int step = sqlite3_step(statement);
        const unsigned char* text = step == SQLITE_ROW ? sqlite3_column_text(statement, 0) : nullptr;
        const std::string value = text ? reinterpret_cast<const char*>(text) : "";
        const std::string error = step == SQLITE_ROW || step == SQLITE_DONE ? "" : sqlite3_errmsg(handle);
        sqlite3_finalize(statement);
        if (!error.empty()) throw std::runtime_error(error);
        return value;
    }

private:
    sqlite3* handle = nullptr;
    void* cache = nullptr;
};

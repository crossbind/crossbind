#pragma once

#include <sqlite3.h>

#include <stdexcept>
#include <string>

// An in-memory SQLite database, the one the home page queries. Rows come back as one JSON array, so the binding
// stays two methods wide. The raw sqlite3* is private, as the binder requires, and a failed statement throws with
// SQLite's own message.
class Database {
public:
    Database() {
        if (sqlite3_open(":memory:", &handle) != SQLITE_OK) throw std::runtime_error("cannot open the database");
    }

    ~Database() { sqlite3_close(handle); }

    std::string version() { return sqlite3_libversion(); }

    void exec(const std::string& sql) { run(sql); }

    std::string query(const std::string& sql) {
        rows = "[";
        run(sql);
        rows += "]";
        return rows;
    }

private:
    void run(const std::string& sql) {
        char* message = nullptr;
        if (sqlite3_exec(handle, sql.c_str(), collect, this, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : "unknown error";
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    static int collect(void* owner, int count, char** values, char** names) {
        Database* self = static_cast<Database*>(owner);
        if (self->rows.size() > 1) self->rows += ",";
        self->rows += "{";
        for (int column = 0; column < count; column += 1) {
            if (column) self->rows += ",";
            self->rows += quote(names[column]) + ":" + (values[column] ? quote(values[column]) : "null");
        }
        self->rows += "}";
        return 0;
    }

    static std::string quote(const char* text) {
        std::string out = "\"";
        for (const char* character = text; *character; character += 1) {
            if (*character == '"' || *character == '\\') out += '\\';
            out += *character;
        }
        return out + "\"";
    }

    sqlite3* handle = nullptr;
    std::string rows;
};

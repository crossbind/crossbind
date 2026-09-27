#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// A whole database as bytes and back. sqlite3_serialize copies out the bytes SQLite would store in
// a database file, and sqlite3_deserialize opens such bytes as a database: in a browser, that is how
// a database is downloaded, uploaded, kept in IndexedDB or sent over the network. Bytes cross the
// binding as a byte string, one UTF-16 code unit (0-255) per byte.
class Snapshot {
public:
    Snapshot() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
    }

    ~Snapshot() { sqlite3_close(db); }

    void exec(const std::string& sql) {
        char* message = nullptr;
        if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : "unknown error";
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    // The database file's bytes.
    std::u16string save() {
        sqlite3_int64 size = 0;
        unsigned char* data = sqlite3_serialize(db, "main", &size, 0);
        if (!data) throw std::runtime_error("sqlite3_serialize could not copy the database");
        std::u16string bytes(static_cast<size_t>(size), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) bytes[i] = data[i];
        sqlite3_free(data);
        return bytes;
    }

    // Replaces this database with the one in `bytes`.
    void load(const std::u16string& bytes) {
        auto* data = static_cast<unsigned char*>(sqlite3_malloc64(bytes.size()));
        if (!data) throw std::runtime_error("out of memory");
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) {
                sqlite3_free(data);
                throw std::invalid_argument("not a byte string");
            }
            data[i] = static_cast<unsigned char>(bytes[i]);
        }
        // SQLite owns `data` from here on, and frees it even when this call fails.
        const int flags = SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE;
        if (sqlite3_deserialize(db, "main", data, bytes.size(), bytes.size(), flags) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
    }

    // Each table as "name(column TYPE, ...): N rows", one per line.
    std::string describe() {
        Statement tables = prepare("select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name");
        std::string out;
        while (sqlite3_step(tables.get()) == SQLITE_ROW) {
            const std::string table = reinterpret_cast<const char*>(sqlite3_column_text(tables.get(), 0));
            out += (out.empty() ? "" : "\n") + table + "(" + columnsOf(table) + "): " + std::to_string(rowsIn(table)) + " rows";
        }
        return out;
    }

private:
    std::string columnsOf(const std::string& table) {
        Statement columns = prepare("select name, type from pragma_table_info(?1)");
        sqlite3_bind_text(columns.get(), 1, table.c_str(), static_cast<int>(table.size()), SQLITE_TRANSIENT);
        std::string out;
        while (sqlite3_step(columns.get()) == SQLITE_ROW) {
            out += (out.empty() ? "" : ", ") + std::string(reinterpret_cast<const char*>(sqlite3_column_text(columns.get(), 0))) + " " +
                   reinterpret_cast<const char*>(sqlite3_column_text(columns.get(), 1));
        }
        return out;
    }

    long long rowsIn(const std::string& table) {
        // A table name cannot be a bound parameter, so it is quoted as an identifier instead.
        std::string quoted = "\"";
        for (char c : table) quoted += c == '"' ? std::string("\"\"") : std::string(1, c);
        Statement count = prepare(("select count(*) from " + quoted + "\"").c_str());
        return sqlite3_step(count.get()) == SQLITE_ROW ? sqlite3_column_int64(count.get(), 0) : 0;
    }

    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    sqlite3* db = nullptr;
};

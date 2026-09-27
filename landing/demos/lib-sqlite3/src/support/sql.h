#pragma once

#include <sqlite3.h>

#include <cmath>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>

// What every app wrapper needs around the C API: a connection and statements that close
// themselves, SQLite errors as exceptions, and result values as JSON text. The usage examples spell
// the same few lines out in their own headers, so each one reads on its own.
namespace sql {

class Connection {
public:
    explicit Connection(const std::string& path, int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE) {
        const int result = sqlite3_open_v2(path.c_str(), &handle, flags, nullptr);
        if (result == SQLITE_OK) return;
        const std::string reason = handle ? sqlite3_errmsg(handle) : sqlite3_errstr(result);
        sqlite3_close(handle);
        throw std::runtime_error(reason);
    }

    ~Connection() { sqlite3_close(handle); }

    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    sqlite3* get() const { return handle; }

private:
    sqlite3* handle = nullptr;
};

using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

inline Statement prepare(sqlite3* db, const std::string& text) {
    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(db, text.c_str(), static_cast<int>(text.size()), &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
    if (!statement) throw std::invalid_argument("no SQL statement to run");
    return Statement(statement, sqlite3_finalize);
}

inline void exec(sqlite3* db, const std::string& text) {
    char* message = nullptr;
    if (sqlite3_exec(db, text.c_str(), nullptr, nullptr, &message) == SQLITE_OK) return;
    const std::string reason = message ? message : sqlite3_errmsg(db);
    sqlite3_free(message);
    throw std::runtime_error(reason);
}

inline void bind(sqlite3_stmt* statement, int index, const std::string& text) {
    sqlite3_bind_text(statement, index, text.data(), static_cast<int>(text.size()), SQLITE_TRANSIENT);
}

// True while the statement has a row; an error becomes an exception with SQLite's message.
inline bool step(sqlite3* db, sqlite3_stmt* statement) {
    const int result = sqlite3_step(statement);
    if (result == SQLITE_ROW) return true;
    if (result == SQLITE_DONE) return false;
    throw std::runtime_error(sqlite3_errmsg(db));
}

inline std::string text(sqlite3_stmt* statement, int column) {
    const unsigned char* value = sqlite3_column_text(statement, column);
    return value ? std::string(reinterpret_cast<const char*>(value), static_cast<size_t>(sqlite3_column_bytes(statement, column))) : std::string();
}

// Runs `work` inside one transaction: commits what it did, or rolls it all back and rethrows.
template <typename Work>
auto transaction(sqlite3* db, Work work) -> decltype(work()) {
    exec(db, "begin");
    try {
        auto result = work();
        exec(db, "commit");
        return result;
    } catch (...) {
        sqlite3_exec(db, "rollback", nullptr, nullptr, nullptr);
        throw;
    }
}

// A double-quoted identifier, safe for any table name a file may contain.
inline std::string identifier(const std::string& name) {
    std::string out = "\"";
    for (char character : name) {
        if (character == '"') out += '"';
        out += character;
    }
    return out + "\"";
}

inline std::string quote(const std::string& value) {
    static const char* const hex = "0123456789abcdef";
    std::string out = "\"";
    for (unsigned char character : value) {
        if (character == '"' || character == '\\') {
            out += '\\';
            out += static_cast<char>(character);
        } else if (character < 0x20) {
            out += "\\u00";
            out += hex[character >> 4];
            out += hex[character & 15];
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

// One result value as JSON. Integers past 2^53 stay exact as strings, reals keep SQLite's own
// formatting (15 significant digits), and a blob becomes {"blob": <bytes>}.
inline std::string json(sqlite3_stmt* statement, int column) {
    switch (sqlite3_column_type(statement, column)) {
        case SQLITE_NULL:
            return "null";
        case SQLITE_INTEGER: {
            const sqlite3_int64 value = sqlite3_column_int64(statement, column);
            const sqlite3_int64 safe = 9007199254740991LL;
            return value <= safe && value >= -safe ? std::to_string(value) : quote(std::to_string(value));
        }
        case SQLITE_FLOAT: {
            const double value = sqlite3_column_double(statement, column);
            if (std::isnan(value)) return "null";
            if (std::isinf(value)) return quote(value > 0 ? "Infinity" : "-Infinity");
            return text(statement, column);
        }
        case SQLITE_BLOB:
            return "{\"blob\":" + std::to_string(sqlite3_column_bytes(statement, column)) + "}";
        default:
            return quote(text(statement, column));
    }
}

}  // namespace sql

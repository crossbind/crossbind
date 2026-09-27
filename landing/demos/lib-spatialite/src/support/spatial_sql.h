#pragma once

#include <sqlite3.h>
#include <spatialite.h>

#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

// What the app wrappers share around the C API: a SQLite connection with SpatiaLite registered on it,
// statements that finalize themselves, errors as exceptions, and result rows as JSON in which every
// geometry arrives as GeoJSON. The usage examples spell the same few lines out in their own headers,
// so each one reads on its own.
namespace spatial {

class Connection {
public:
    explicit Connection(const std::string& path, int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE) {
        const int result = sqlite3_open_v2(path.c_str(), &handle, flags, nullptr);
        if (result != SQLITE_OK) {
            const std::string reason = handle ? sqlite3_errmsg(handle) : sqlite3_errstr(result);
            sqlite3_close(handle);
            throw std::runtime_error(reason);
        }
        cache = spatialite_alloc_connection();
        spatialite_init_ex(handle, cache, 0);
    }

    ~Connection() {
        sqlite3_close(handle);
        spatialite_cleanup_ex(cache);
    }

    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    sqlite3* get() const { return handle; }

private:
    sqlite3* handle = nullptr;
    void* cache = nullptr;
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

// A double-quoted SQL identifier, safe for any table or column name a file may contain.
inline std::string identifier(const std::string& name) {
    std::string out = "\"";
    for (char character : name) {
        if (character == '"') out += '"';
        out += character;
    }
    return out + "\"";
}

// Result rows as JSON: {"columns": [...], "rows": [[...]], "total": n}. Only the first `limit` rows
// are written, `total` counts them all. A cell holding a SpatiaLite geometry becomes
// {"geometry": <GeoJSON>, "type": "POLYGON", "srid": 4326}, any other blob {"blob": <bytes>}.
class ResultWriter {
public:
    explicit ResultWriter(sqlite3* db)
        : db(db), geometry(prepare(db, "SELECT AsGeoJSON(?1, 6), GeometryType(?1), SRID(?1)")) {}

    std::string rows(sqlite3_stmt* statement, int limit) {
        const int columns = sqlite3_column_count(statement);
        std::string out = "{\"columns\":[";
        for (int column = 0; column < columns; column += 1) {
            const char* name = sqlite3_column_name(statement, column);
            out += (column ? "," : "") + quote(name ? name : "");
        }
        out += "],\"rows\":[";
        int total = 0;
        while (step(db, statement)) {
            if (total < limit) {
                out += total ? ",[" : "[";
                for (int column = 0; column < columns; column += 1) out += (column ? "," : "") + cell(statement, column);
                out += "]";
            }
            total += 1;
        }
        return out + "],\"total\":" + std::to_string(total) + "}";
    }

    std::string cell(sqlite3_stmt* statement, int column) {
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
                if (!std::isfinite(value)) return "null";
                return text(statement, column);
            }
            case SQLITE_BLOB:
                return blob(statement, column);
            default:
                return quote(text(statement, column));
        }
    }

private:
    std::string blob(sqlite3_stmt* statement, int column) {
        const int bytes = sqlite3_column_bytes(statement, column);
        sqlite3_reset(geometry.get());
        sqlite3_bind_blob(geometry.get(), 1, sqlite3_column_blob(statement, column), bytes, SQLITE_TRANSIENT);
        if (step(db, geometry.get()) && sqlite3_column_type(geometry.get(), 0) != SQLITE_NULL) {
            return "{\"geometry\":" + text(geometry.get(), 0) + ",\"type\":" + quote(text(geometry.get(), 1)) +
                   ",\"srid\":" + std::to_string(sqlite3_column_int(geometry.get(), 2)) + "}";
        }
        return "{\"blob\":" + std::to_string(bytes) + "}";
    }

    sqlite3* db;
    Statement geometry;
};

// Adds how many statements ran to a result from ResultWriter::rows, or makes an empty result when no
// statement returned rows.
inline std::string withStatements(const std::string& rows, int statements) {
    const std::string body = rows.empty() ? "{\"columns\":[],\"rows\":[],\"total\":0}" : rows;
    return body.substr(0, body.size() - 1) + ",\"statements\":" + std::to_string(statements) + "}";
}

}  // namespace spatial

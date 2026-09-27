#pragma once

#include <sqlite3.h>

#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>

#include "../support/api_log.h"
#include "../support/sql.h"

// Opens a SQLite file the page mounted (a visitor's .sqlite, .db, .gpkg or .mbtiles, or the
// generated sample) and answers what is inside. The file is opened read-only through an immutable
// URI: SQLite never writes to it and takes no locks, and a WAL-mode file opens without its -wal and
// -shm companions. Results come back as JSON text.
class DbExplorer {
public:
    explicit DbExplorer(const std::string& path) : file(path), db(uri(path), SQLITE_OPEN_READONLY | SQLITE_OPEN_URI) {
        sqlite3_progress_handler(db.get(), 1000, stopAtDeadline, this);
        arm(QUERY_SECONDS);
        // Reading the schema is what tells a database from any other file ("file is not a database").
        sql::exec(db.get(), "select count(*) from sqlite_schema");
    }

    static std::string version() { return sqlite3_libversion(); }

    // Writes the sample API log (support/api_log.h) to `path`; returns how many requests it holds.
    static int writeSample(const std::string& path, int requests, unsigned int seed) { return apilog::write(path, requests, seed); }

    // The 100-byte file header, read directly:
    // {"bytes","pageSize","pages","journal","encoding","userVersion","applicationId","kind","writtenBy"}.
    std::string info() {
        std::unique_ptr<FILE, int (*)(FILE*)> handle(std::fopen(file.c_str(), "rb"), std::fclose);
        if (!handle) throw std::runtime_error("cannot open " + file);
        unsigned char header[100] = {0};
        if (std::fread(header, 1, sizeof header, handle.get()) != sizeof header) throw std::runtime_error("the file is shorter than a SQLite header");
        std::fseek(handle.get(), 0, SEEK_END);
        const long bytes = std::ftell(handle.get());
        const auto number = [&header](int at, int size) {
            uint32_t value = 0;
            for (int index = 0; index < size; index += 1) value = (value << 8) | header[at + index];
            return value;
        };
        static const char* const encodings[] = {"unknown", "UTF-8", "UTF-16le", "UTF-16be"};
        const uint32_t encoding = number(56, 4);
        const uint32_t written = number(96, 4);
        return "{\"bytes\":" + std::to_string(bytes) + ",\"pageSize\":" + std::to_string(number(16, 2) == 1 ? 65536 : number(16, 2)) +
               ",\"pages\":" + std::to_string(pageCount()) + ",\"journal\":\"" + (header[18] == 2 ? "WAL" : "rollback") + "\",\"encoding\":\"" +
               encodings[encoding <= 3 ? encoding : 0] + "\",\"userVersion\":" + std::to_string(number(60, 4)) +
               ",\"applicationId\":" + std::to_string(number(68, 4)) + ",\"kind\":\"" + kind(number(68, 4)) + "\",\"writtenBy\":\"" +
               std::to_string(written / 1000000) + "." + std::to_string(written / 1000 % 1000) + "." + std::to_string(written % 1000) + "\"}";
    }

    // Tables, views, indexes and triggers; tables and views with their columns, tables with row counts:
    // [{"name","type","table","columns":[{"name","type","pk","notnull"}],"rows"}]
    std::string tables() {
        arm(QUERY_SECONDS);
        sql::Statement list = sql::prepare(db.get(),
                                           "select name, type, tbl_name from sqlite_schema where type in ('table', 'view', 'index', 'trigger') order by "
                                           "case type when 'table' then 0 when 'view' then 1 when 'index' then 2 else 3 end, name");
        std::string out = "[";
        while (sql::step(db.get(), list.get())) {
            const std::string name = sql::text(list.get(), 0);
            const std::string type = sql::text(list.get(), 1);
            out += std::string(out.size() > 1 ? "," : "") + "{\"name\":" + sql::quote(name) + ",\"type\":" + sql::quote(type) +
                   ",\"table\":" + sql::quote(sql::text(list.get(), 2));
            if (type == "table" || type == "view") out += describe(name, type == "table");
            out += "}";
        }
        return out + "]";
    }

    // Runs `statements` (one or more) and returns the last one's result, at most `maxRows` rows:
    // {"columns":[...],"rows":[[...]],"truncated":bool,"ms":n}.
    std::string query(const std::string& statements, int maxRows) {
        arm(QUERY_SECONDS);
        const auto started = std::chrono::steady_clock::now();
        const std::string result = eachStatement(statements, [&](sqlite3_stmt* statement) { return rows(statement, maxRows); });
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        char elapsed[32];
        std::snprintf(elapsed, sizeof elapsed, "%.2f", ms);
        return result + ",\"ms\":" + elapsed + "}";
    }

    // The last statement's full result as CSV (RFC 4180): a header row, then every row.
    std::string csv(const std::string& statements) {
        arm(EXPORT_SECONDS);
        return eachStatement(statements, [&](sqlite3_stmt* statement) { return table(statement); });
    }

    // PRAGMA quick_check: "ok", or the problems it found, one per line.
    std::string check() {
        arm(EXPORT_SECONDS);
        sql::Statement statement = sql::prepare(db.get(), "pragma quick_check(20)");
        std::string out;
        while (sql::step(db.get(), statement.get())) out += (out.empty() ? "" : "\n") + sql::text(statement.get(), 0);
        return out;
    }

    // VACUUM INTO: writes a compacted copy of the database to `path` and returns its size in bytes.
    double saveAs(const std::string& path) {
        arm(EXPORT_SECONDS);
        std::remove(path.c_str());
        sql::Statement vacuum = sql::prepare(db.get(), "vacuum into ?1");
        sql::bind(vacuum.get(), 1, path);
        sql::step(db.get(), vacuum.get());
        std::unique_ptr<FILE, int (*)(FILE*)> copy(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!copy) throw std::runtime_error("VACUUM INTO wrote no file at " + path);
        std::fseek(copy.get(), 0, SEEK_END);
        return static_cast<double>(std::ftell(copy.get()));
    }

private:
    static constexpr int QUERY_SECONDS = 10;
    static constexpr int EXPORT_SECONDS = 60;

    // "file:" plus the percent-encoded path, so a name with spaces, '?' or '#' still opens.
    static std::string uri(const std::string& path) {
        static const char* const hex = "0123456789ABCDEF";
        std::string out = "file:";
        for (unsigned char character : path) {
            if (std::isalnum(character) || character == '/' || character == '-' || character == '_' || character == '.' || character == '~') {
                out += static_cast<char>(character);
            } else {
                out += '%';
                out += hex[character >> 4];
                out += hex[character & 15];
            }
        }
        return out + "?immutable=1";
    }

    static const char* kind(uint32_t applicationId) {
        switch (applicationId) {
            case 0x47504B47:  // "GPKG"
            case 0x47503130:  // "GP10"
            case 0x47503131:  // "GP11"
                return "GeoPackage";
            case 0x4D504258:  // "MPBX"
                return "MBTiles";
            default:
                return "SQLite database";
        }
    }

    // A long query is stopped at the deadline instead of holding the module's worker.
    static int stopAtDeadline(void* self) { return std::chrono::steady_clock::now() > static_cast<DbExplorer*>(self)->deadline ? 1 : 0; }

    void arm(int seconds) { deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds); }

    long long pageCount() {
        sql::Statement statement = sql::prepare(db.get(), "pragma page_count");
        return sql::step(db.get(), statement.get()) ? sqlite3_column_int64(statement.get(), 0) : 0;
    }

    // ,"columns":[...],"rows":N for one table or view. A virtual table whose module this build lacks
    // (an FTS5 index, say) reports the error instead of failing the whole listing.
    std::string describe(const std::string& name, bool count) {
        try {
            sql::Statement info = sql::prepare(db.get(), "select name, type, pk, \"notnull\" from pragma_table_info(?1)");
            sql::bind(info.get(), 1, name);
            std::string columns = "[";
            while (sql::step(db.get(), info.get())) {
                columns += std::string(columns.size() > 1 ? "," : "") + "{\"name\":" + sql::quote(sql::text(info.get(), 0)) +
                           ",\"type\":" + sql::quote(sql::text(info.get(), 1)) + ",\"pk\":" + std::to_string(sqlite3_column_int(info.get(), 2)) +
                           ",\"notnull\":" + (sqlite3_column_int(info.get(), 3) ? "true" : "false") + "}";
            }
            std::string rows = "null";
            if (count) {
                sql::Statement counter = sql::prepare(db.get(), "select count(*) from " + sql::identifier(name));
                sql::step(db.get(), counter.get());
                rows = std::to_string(sqlite3_column_int64(counter.get(), 0));
            }
            return ",\"columns\":" + columns + "],\"rows\":" + rows;
        } catch (const std::exception& error) {
            return ",\"columns\":[],\"rows\":null,\"error\":" + sql::quote(error.what());
        }
    }

    // Prepares and runs each statement of `statements` in turn; returns what `collect` made of the last.
    template <typename Collect>
    std::string eachStatement(const std::string& statements, Collect collect) {
        std::string result;
        bool ran = false;
        const char* rest = statements.c_str();
        const char* end = rest + statements.size();
        while (rest < end) {
            sqlite3_stmt* raw = nullptr;
            const char* tail = nullptr;
            if (sqlite3_prepare_v2(db.get(), rest, static_cast<int>(end - rest), &raw, &tail) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db.get()));
            rest = tail;
            if (!raw) continue;  // only whitespace or a comment was left
            sql::Statement statement(raw, sqlite3_finalize);
            result = collect(statement.get());
            ran = true;
        }
        if (!ran) throw std::invalid_argument("no SQL statement to run");
        return result;
    }

    static std::string columnName(sqlite3_stmt* statement, int column) {
        const char* name = sqlite3_column_name(statement, column);
        return name ? name : "";
    }

    // {"columns":[...],"rows":[[...]],"truncated":bool  (left open for the caller to finish)
    std::string rows(sqlite3_stmt* statement, int maxRows) {
        const int columns = sqlite3_column_count(statement);
        std::string names = "[";
        for (int column = 0; column < columns; column += 1) names += (column ? "," : "") + sql::quote(columnName(statement, column));
        std::string out = "[";
        int count = 0;
        bool truncated = false;
        while (sql::step(db.get(), statement)) {
            if (count == maxRows) {
                truncated = true;
                break;
            }
            out += count ? ",[" : "[";
            for (int column = 0; column < columns; column += 1) out += (column ? "," : "") + sql::json(statement, column);
            out += "]";
            count += 1;
        }
        return "{\"columns\":" + names + "],\"rows\":" + out + "],\"truncated\":" + (truncated ? "true" : "false");
    }

    static std::string field(const std::string& value) {
        if (value.find_first_of(",\"\r\n") == std::string::npos) return value;
        std::string out = "\"";
        for (char character : value) out += character == '"' ? std::string("\"\"") : std::string(1, character);
        return out + "\"";
    }

    static std::string cell(sqlite3_stmt* statement, int column) {
        if (sqlite3_column_type(statement, column) != SQLITE_BLOB) return field(sql::text(statement, column));
        static const char* const hex = "0123456789abcdef";
        const auto* data = static_cast<const unsigned char*>(sqlite3_column_blob(statement, column));
        std::string out;
        for (int index = 0; index < sqlite3_column_bytes(statement, column); index += 1) {
            out += hex[data[index] >> 4];
            out += hex[data[index] & 15];
        }
        return out;
    }

    std::string table(sqlite3_stmt* statement) {
        const int columns = sqlite3_column_count(statement);
        std::string out;
        for (int column = 0; column < columns; column += 1) out += (column ? "," : "") + field(columnName(statement, column));
        out += "\r\n";
        while (sql::step(db.get(), statement)) {
            for (int column = 0; column < columns; column += 1) out += (column ? "," : "") + cell(statement, column);
            out += "\r\n";
        }
        return out;
    }

    const std::string file;
    sql::Connection db;
    std::chrono::steady_clock::time_point deadline;
};

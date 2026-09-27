#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// Notes in an in-memory SQLite database. Values reach SQL only as bound parameters (?1), never by
// pasting them into the statement, so a quote inside a note is data, not SQL.
class Notes {
public:
    Notes() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        run("create table notes(id integer primary key, body text not null)");
    }

    ~Notes() { sqlite3_close(db); }

    static std::string version() { return sqlite3_libversion(); }

    // Inserts one note and returns its id.
    int add(const std::string& body) {
        Statement insert = prepare("insert into notes(body) values (?1)");
        sqlite3_bind_text(insert.get(), 1, body.c_str(), static_cast<int>(body.size()), SQLITE_TRANSIENT);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return static_cast<int>(sqlite3_last_insert_rowid(db));
    }

    int count() {
        Statement query = prepare("select count(*) from notes");
        return sqlite3_step(query.get()) == SQLITE_ROW ? sqlite3_column_int(query.get(), 0) : 0;
    }

    // Every note containing `word`, oldest first, one "id: body" line each.
    std::string find(const std::string& word) {
        Statement query = prepare("select id, body from notes where body like '%' || ?1 || '%' order by id");
        sqlite3_bind_text(query.get(), 1, word.c_str(), static_cast<int>(word.size()), SQLITE_TRANSIENT);
        std::string lines;
        int result;
        while ((result = sqlite3_step(query.get())) == SQLITE_ROW) {
            const int id = sqlite3_column_int(query.get(), 0);
            const char* body = reinterpret_cast<const char*>(sqlite3_column_text(query.get(), 1));
            lines += (lines.empty() ? "" : "\n") + std::to_string(id) + ": " + body;
        }
        if (result != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return lines;
    }

private:
    // Finalizes the statement however the method returns.
    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    void run(const char* sql) {
        char* message = nullptr;
        if (sqlite3_exec(db, sql, nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : "unknown error";
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    sqlite3* db = nullptr;
};

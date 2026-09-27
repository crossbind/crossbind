#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// Full-text search with SQLite's FTS4 module (this build has FTS3 and FTS4, not FTS5). The porter
// tokenizer reduces English words to their stems, so "parse" also finds "parses" and "parsing".
// MATCH takes FTS query syntax: "a phrase", prefix*, NOT, OR and NEAR/n.
class SearchIndex {
public:
    SearchIndex() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        run("create virtual table docs using fts4(title, body, tokenize=porter)");
    }

    ~SearchIndex() { sqlite3_close(db); }

    void add(const std::string& title, const std::string& body) {
        Statement insert = prepare("insert into docs(title, body) values (?1, ?2)");
        sqlite3_bind_text(insert.get(), 1, title.c_str(), static_cast<int>(title.size()), SQLITE_TRANSIENT);
        sqlite3_bind_text(insert.get(), 2, body.c_str(), static_cast<int>(body.size()), SQLITE_TRANSIENT);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
    }

    // A snippet of every matching document, in the order they were added, with the hits in
    // [brackets]; the snippets are joined by " | ".
    std::string search(const std::string& query) {
        Statement select = prepare("select snippet(docs, '[', ']', '…', -1, 8) from docs where docs match ?1 order by docid");
        sqlite3_bind_text(select.get(), 1, query.c_str(), static_cast<int>(query.size()), SQLITE_TRANSIENT);
        std::string out;
        int result;
        while ((result = sqlite3_step(select.get())) == SQLITE_ROW) {
            out += (out.empty() ? "" : " | ") + std::string(reinterpret_cast<const char*>(sqlite3_column_text(select.get(), 0)));
        }
        if (result != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return out;
    }

private:
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

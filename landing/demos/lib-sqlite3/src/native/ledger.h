#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// Account balances updated in batches. A batch is one transaction: BEGIN, one prepared upsert that
// is reset and re-bound for every row, then COMMIT. When a row fails, ROLLBACK undoes the rows
// before it too, so a batch is applied completely or not at all.
class Ledger {
public:
    Ledger() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        run("create table balances(account text primary key, total integer not null check (total >= 0))");
    }

    ~Ledger() { sqlite3_close(db); }

    // `rows` holds one "account,amount" line per entry; returns how many rows were applied.
    int apply(const std::string& rows) {
        run("begin");
        try {
            const int applied = upsertEach(rows);
            run("commit");
            return applied;
        } catch (...) {
            sqlite3_exec(db, "rollback", nullptr, nullptr, nullptr);
            throw;
        }
    }

    // "account total" pairs in account order.
    std::string balances() {
        Statement query = prepare("select account, total from balances order by account");
        std::string out;
        while (sqlite3_step(query.get()) == SQLITE_ROW) {
            out += (out.empty() ? "" : ", ") + std::string(reinterpret_cast<const char*>(sqlite3_column_text(query.get(), 0))) + " " +
                   std::to_string(sqlite3_column_int64(query.get(), 1));
        }
        return out;
    }

private:
    int upsertEach(const std::string& rows) {
        Statement upsert = prepare(
            "insert into balances(account, total) values (?1, ?2) "
            "on conflict(account) do update set total = total + excluded.total");
        int applied = 0;
        for (size_t start = 0; start < rows.size();) {
            size_t end = rows.find('\n', start);
            if (end == std::string::npos) end = rows.size();
            const std::string row = rows.substr(start, end - start);
            start = end + 1;
            const size_t comma = row.find(',');
            if (comma == std::string::npos) throw std::invalid_argument("expected account,amount but got: " + row);
            sqlite3_bind_text(upsert.get(), 1, row.data(), static_cast<int>(comma), SQLITE_TRANSIENT);
            sqlite3_bind_int64(upsert.get(), 2, std::stoll(row.substr(comma + 1)));
            if (sqlite3_step(upsert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
            sqlite3_reset(upsert.get());
            applied += 1;
        }
        return applied;
    }

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

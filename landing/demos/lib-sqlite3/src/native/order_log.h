#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// Orders stored as JSON documents and queried with SQLite's JSON functions: ->> reads a field,
// json_each turns an array into rows, and json_group_object / json_group_array build the answer
// as JSON again. A CHECK on json_valid() rejects anything that is not JSON.
class OrderLog {
public:
    OrderLog() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        run("create table orders(id integer primary key, doc text not null check (json_valid(doc)))");
    }

    ~OrderLog() { sqlite3_close(db); }

    void add(const std::string& json) {
        Statement insert = prepare("insert into orders(doc) values (?1)");
        sqlite3_bind_text(insert.get(), 1, json.c_str(), static_cast<int>(json.size()), SQLITE_TRANSIENT);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
    }

    // What each customer spent: {"customer": total, ...}
    std::string totals() {
        return value(
            "select json_group_object(customer, total order by customer) from ("
            "  select doc ->> 'customer' as customer, sum((item.value ->> 'qty') * (item.value ->> 'price')) as total"
            "  from orders, json_each(orders.doc, '$.items') as item group by customer)");
    }

    // Units sold per product, best seller first: {"sku": units, ...}
    std::string unitsSold() {
        return value(
            "select json_group_object(sku, units order by units desc, sku) from ("
            "  select item.value ->> 'sku' as sku, sum(item.value ->> 'qty') as units"
            "  from orders, json_each(orders.doc, '$.items') as item group by sku)");
    }

    // The customers who ordered `sku`, as a JSON array.
    std::string buyersOf(const std::string& sku) {
        return value(
            "select json_group_array(distinct doc ->> 'customer' order by doc ->> 'customer')"
            "  from orders, json_each(orders.doc, '$.items') as item where item.value ->> 'sku' = ?1",
            sku);
    }

private:
    // The first column of the first row, with `parameter` bound to ?1.
    std::string value(const char* sql, const std::string& parameter = "") {
        Statement query = prepare(sql);
        if (sqlite3_bind_parameter_count(query.get()) > 0) {
            sqlite3_bind_text(query.get(), 1, parameter.c_str(), static_cast<int>(parameter.size()), SQLITE_TRANSIENT);
        }
        if (sqlite3_step(query.get()) != SQLITE_ROW) throw std::runtime_error(sqlite3_errmsg(db));
        const unsigned char* text = sqlite3_column_text(query.get(), 0);
        return text ? reinterpret_cast<const char*>(text) : "null";
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

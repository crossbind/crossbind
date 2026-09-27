#pragma once

#include <sqlite3.h>

#include <chrono>
#include <stdexcept>
#include <string>

#include "../support/sql.h"
#include "../support/xorshift.h"

// The same points three ways, so one box query can be answered by each: SQLite's R*Tree
// (rtree_i32, which keeps integer coordinates exact), an ordinary table with a B-tree index on x,
// and an ordinary table with no index. The page draws the points itself from the same xorshift32
// sequence; only counts, ids and timings cross the binding.
class SpatialIndex {
public:
    SpatialIndex() : db(":memory:") {
        sql::exec(db.get(),
                  "create virtual table pts using rtree_i32(id, minx, maxx, miny, maxy);"
                  "create table indexed(id integer primary key, x integer not null, y integer not null);"
                  "create index indexed_x on indexed(x);"
                  "create table plain(id integer primary key, x integer not null, y integer not null);");
    }

    // Replaces the points with `count` new ones in [0, 1000)²: per point, x = next() % 1000, then
    // y = next() % 1000, from xorshift32 seeded with `seed`. Returns how many there are.
    int generate(int count, unsigned int seed) {
        if (count < 1 || count > 1000000) throw std::invalid_argument("between 1 and 1,000,000 points");
        return sql::transaction(db.get(), [&] {
            sql::exec(db.get(), "delete from pts; delete from indexed; delete from plain;");
            sql::Statement tree = sql::prepare(db.get(), "insert into pts values (?1, ?2, ?2, ?3, ?3)");
            sql::Statement indexed = sql::prepare(db.get(), "insert into indexed values (?1, ?2, ?3)");
            sql::Statement plain = sql::prepare(db.get(), "insert into plain values (?1, ?2, ?3)");
            XorShift32 random(seed);
            for (int id = 1; id <= count; id += 1) {
                const int x = static_cast<int>(random.next() % 1000);
                const int y = static_cast<int>(random.next() % 1000);
                for (sqlite3_stmt* statement : {tree.get(), indexed.get(), plain.get()}) {
                    sqlite3_bind_int(statement, 1, id);
                    sqlite3_bind_int(statement, 2, x);
                    sqlite3_bind_int(statement, 3, y);
                    sql::step(db.get(), statement);
                    sqlite3_reset(statement);
                }
            }
            return count;
        });
    }

    // Points inside the box (edges included), counted by `method`: "rtree", "btree" or "scan".
    int count(int minX, int minY, int maxX, int maxY, const std::string& method) {
        sql::Statement statement = boxQuery("select count(*)", method, minX, minY, maxX, maxY);
        return sql::step(db.get(), statement.get()) ? sqlite3_column_int(statement.get(), 0) : 0;
    }

    // Ids of the first `limit` points inside the box, from the R*Tree, as a JSON array.
    std::string ids(int minX, int minY, int maxX, int maxY, int limit) {
        sql::Statement statement = boxQuery("select id", "rtree", minX, minY, maxX, maxY, " order by id limit ?5");
        sqlite3_bind_int(statement.get(), 5, limit);
        std::string out = "[";
        while (sql::step(db.get(), statement.get())) out += (out.size() > 1 ? "," : "") + std::to_string(sqlite3_column_int(statement.get(), 0));
        return out + "]";
    }

    // What SQLite's planner does with the box query: the EXPLAIN QUERY PLAN detail.
    std::string plan(const std::string& method) {
        sql::Statement statement = boxQuery("explain query plan select count(*)", method, 0, 0, 0, 0);
        std::string out;
        while (sql::step(db.get(), statement.get())) out += (out.empty() ? "" : "; ") + sql::text(statement.get(), 3);
        return out;
    }

    // Milliseconds per box query with `method`, averaged over as many runs as fit in about 30 ms.
    double measure(int minX, int minY, int maxX, int maxY, const std::string& method) {
        sql::Statement statement = boxQuery("select count(*)", method, minX, minY, maxX, maxY);
        const auto started = std::chrono::steady_clock::now();
        int runs = 0;
        double elapsed = 0;
        while (runs < 5000 && (runs < 3 || elapsed < 30)) {
            sql::step(db.get(), statement.get());
            sqlite3_reset(statement.get());
            runs += 1;
            elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        }
        return elapsed / runs;
    }

private:
    sql::Statement boxQuery(const std::string& select, const std::string& method, int minX, int minY, int maxX, int maxY, const std::string& tail = "") {
        std::string where;
        if (method == "rtree") where = " from pts where minx >= ?1 and maxx <= ?3 and miny >= ?2 and maxy <= ?4";
        else if (method == "btree") where = " from indexed where x between ?1 and ?3 and y between ?2 and ?4";
        else if (method == "scan") where = " from plain where x between ?1 and ?3 and y between ?2 and ?4";
        else throw std::invalid_argument("method is rtree, btree or scan");
        sql::Statement statement = sql::prepare(db.get(), select + where + tail);
        sqlite3_bind_int(statement.get(), 1, minX);
        sqlite3_bind_int(statement.get(), 2, minY);
        sqlite3_bind_int(statement.get(), 3, maxX);
        sqlite3_bind_int(statement.get(), 4, maxY);
        return statement;
    }

    sql::Connection db;
};

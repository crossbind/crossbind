#pragma once

#include <sqlite3.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/sql.h"

// Full-text search over documents the page hands in: SQLite's FTS4 finds the matches and a BM25
// function written in C++ ranks them. FTS4 has no ranking function of its own (FTS5 has bm25(), but
// this build does not include FTS5), so the wrapper registers one with sqlite3_create_function.
class DocSearch {
public:
    DocSearch() : db(":memory:") {
        sql::exec(db.get(),
                  "create table pages(id integer primary key, title text not null, section text not null, href text not null);"
                  "create virtual table docs using fts4(heading, body, tokenize=porter);");
        if (sqlite3_create_function(db.get(), "bm25", -1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, nullptr, bm25, nullptr, nullptr) != SQLITE_OK) {
            throw std::runtime_error(sqlite3_errmsg(db.get()));
        }
    }

    static std::string version() { return sqlite3_libversion(); }

    // Indexes a JSON array of {"title","section","href","body"} in one transaction; SQLite's own
    // json_each reads the array. Returns how many documents the index holds.
    int addJson(const std::string& documents) {
        return sql::transaction(db.get(), [&] {
            const int first = size() + 1;
            sql::Statement pages = sql::prepare(db.get(),
                                                "insert into pages(id, title, section, href) select ?2 + key, value ->> 'title', "
                                                "coalesce(value ->> 'section', ''), coalesce(value ->> 'href', '') from json_each(?1)");
            sql::Statement docs = sql::prepare(db.get(),
                                               "insert into docs(docid, heading, body) select ?2 + key, "
                                               "trim((value ->> 'title') || ' ' || coalesce(value ->> 'section', '')), value ->> 'body' from json_each(?1)");
            for (sqlite3_stmt* statement : {pages.get(), docs.get()}) {
                sql::bind(statement, 1, documents);
                sqlite3_bind_int(statement, 2, first);
                sql::step(db.get(), statement);
            }
            return size();
        });
    }

    int size() {
        sql::Statement count = sql::prepare(db.get(), "select count(*) from pages");
        return sql::step(db.get(), count.get()) ? sqlite3_column_int(count.get(), 0) : 0;
    }

    // The best `limit` matches of an FTS query (words, "phrases", prefix*, OR, NOT, NEAR/n):
    // {"total":N,"ms":n,"hits":[{"title","section","href","snippet","score"}]}. The snippet marks
    // each hit with \u0002 before it and \u0003 after it, characters no document text contains.
    std::string search(const std::string& query, int limit) {
        const auto started = std::chrono::steady_clock::now();
        sql::Statement count = sql::prepare(db.get(), "select count(*) from docs where docs match ?1");
        sql::bind(count.get(), 1, query);
        const int total = sql::step(db.get(), count.get()) ? sqlite3_column_int(count.get(), 0) : 0;
        sql::Statement hits = sql::prepare(db.get(),
                                           "select pages.title, pages.section, pages.href, snippet(docs, char(2), char(3), '…', 1, 14), "
                                           "bm25(matchinfo(docs, 'pcnalx'), 3.0, 1.0) as score from docs join pages on pages.id = docs.docid "
                                           "where docs match ?1 order by score desc, docs.docid limit ?2");
        sql::bind(hits.get(), 1, query);
        sqlite3_bind_int(hits.get(), 2, limit);
        std::string found;
        for (int index = 0; sql::step(db.get(), hits.get()); index += 1) {
            found += std::string(index ? "," : "") + "{\"title\":" + sql::json(hits.get(), 0) + ",\"section\":" + sql::json(hits.get(), 1) +
                     ",\"href\":" + sql::json(hits.get(), 2) + ",\"snippet\":" + sql::json(hits.get(), 3) + ",\"score\":" + sql::json(hits.get(), 4) + "}";
        }
        char ms[32];
        std::snprintf(ms, sizeof ms, "%.3f", std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count());
        return "{\"total\":" + std::to_string(total) + ",\"ms\":" + ms + ",\"hits\":[" + found + "]}";
    }

private:
    // bm25(matchinfo(docs, 'pcnalx'), weight per column...): Okapi BM25 with k1 = 1.2 and b = 0.75,
    // summed over the query's phrases and the table's columns, each column scaled by its weight.
    // idf = ln(1 + (N - n + 0.5) / (n + 0.5)) stays positive even for a word most documents contain.
    static void bm25(sqlite3_context* context, int argc, sqlite3_value** argv) {
        const double k1 = 1.2;
        const double b = 0.75;
        const int bytes = argc > 0 ? sqlite3_value_bytes(argv[0]) : 0;
        if (argc < 1 || sqlite3_value_type(argv[0]) != SQLITE_BLOB || bytes < 12) {
            sqlite3_result_error(context, "bm25() takes matchinfo(table, 'pcnalx') first", -1);
            return;
        }
        std::vector<unsigned int> info(static_cast<size_t>(bytes) / sizeof(unsigned int));
        std::memcpy(info.data(), sqlite3_value_blob(argv[0]), info.size() * sizeof(unsigned int));
        const unsigned int phrases = info[0];
        const unsigned int columns = info[1];
        const double rows = info[2];
        if (info.size() != 3 + 2 * columns + 3 * phrases * columns) {
            sqlite3_result_error(context, "bm25() needs matchinfo with the 'pcnalx' format", -1);
            return;
        }
        const unsigned int* average = &info[3];
        const unsigned int* length = &info[3 + columns];
        const unsigned int* hits = &info[3 + 2 * columns];
        double score = 0;
        for (unsigned int phrase = 0; phrase < phrases; phrase += 1) {
            for (unsigned int column = 0; column < columns; column += 1) {
                const double weight = static_cast<int>(column) + 1 < argc ? sqlite3_value_double(argv[column + 1]) : 1.0;
                const unsigned int* x = hits + 3 * (phrase * columns + column);
                const double frequency = x[0];
                const double documents = x[2];
                if (weight == 0 || frequency == 0 || average[column] == 0) continue;
                const double idf = std::log(1 + (rows - documents + 0.5) / (documents + 0.5));
                const double norm = 1 - b + b * length[column] / average[column];
                score += weight * idf * frequency * (k1 + 1) / (frequency + k1 * norm);
            }
        }
        sqlite3_result_double(context, score);
    }

    sql::Connection db;
};

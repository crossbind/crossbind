#pragma once

#include <stdexcept>
#include <string>

#include "../support/sample_data.h"
#include "../support/spatial_sql.h"

// A spatial SQL playground: an in-memory SpatiaLite database holding the generated sample (tables
// cities, pois and hexagons), which runs whatever SQL the page sends it.
class SpatialPlayground {
public:
    SpatialPlayground() : connection(":memory:") { spatial::exec(connection.get(), sample::PLAYGROUND); }

    // Runs every statement of `sql` in turn and returns the rows of the last one that returned
    // columns, at most `limit` of them, with each geometry as GeoJSON (spatial::ResultWriter).
    std::string run(const std::string& sql, int limit) {
        sqlite3* db = connection.get();
        spatial::ResultWriter writer(db);
        std::string rows;
        int statements = 0;
        const char* rest = sql.c_str();
        const char* end = rest + sql.size();
        while (rest < end) {
            sqlite3_stmt* raw = nullptr;
            if (sqlite3_prepare_v2(db, rest, static_cast<int>(end - rest), &raw, &rest) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
            if (!raw) continue;
            const spatial::Statement statement(raw, sqlite3_finalize);
            statements += 1;
            if (sqlite3_column_count(raw) > 0) {
                rows = writer.rows(raw, limit);
            } else {
                while (spatial::step(db, raw)) {
                }
            }
        }
        if (statements == 0) throw std::invalid_argument("no SQL statement to run");
        return spatial::withStatements(rows, statements);
    }

private:
    spatial::Connection connection;
};

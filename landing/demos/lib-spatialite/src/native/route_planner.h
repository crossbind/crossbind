#pragma once

#include <stdexcept>
#include <string>

#include "../support/spatial_sql.h"
#include "../support/street_grid.h"

// Shortest paths computed inside the database. CreateRouting turns the open streets into a
// VirtualRouting network twice: one weighs each street by its travel time, the other by its length,
// which on this grid counts streets. Closing streets rebuilds both.
class RoutePlanner {
public:
    RoutePlanner() : connection(":memory:") {
        spatial::exec(connection.get(), street_grid::STREETS);
        rebuild();
    }

    // Every street as rows of id, node_from, node_to, cost and closed (1 when closed).
    std::string streets() {
        sqlite3* db = connection.get();
        const auto query = spatial::prepare(db, "SELECT id, node_from, node_to, cost, id NOT IN (SELECT id FROM roads) AS closed FROM streets ORDER BY id");
        return spatial::ResultWriter(db).rows(query.get(), 1000);
    }

    // Closes the streets whose ids are in a JSON array, reopens every other one and rebuilds both
    // networks. Returns how many streets are open.
    int closeStreets(const std::string& ids) {
        sqlite3* db = connection.get();
        spatial::exec(db, "DELETE FROM roads");
        const auto reopen = spatial::prepare(db,
            "INSERT INTO roads (id, node_from, node_to, cost, geom) SELECT id, node_from, node_to, cost, geom FROM streets "
            "WHERE id NOT IN (SELECT value FROM json_each(?1))");
        sqlite3_bind_text(reopen.get(), 1, ids.c_str(), -1, SQLITE_TRANSIENT);
        spatial::step(db, reopen.get());
        const int open = sqlite3_changes(db);
        rebuild();
        return open;
    }

    // The route between two intersections as rows of the VirtualRouting table: row 0 is the whole
    // route with its total cost, then one row per street in order. `fewest` counts streets instead of
    // travel time. The table takes only NodeFrom and NodeTo in its WHERE clause.
    std::string route(int from, int to, bool fewest) {
        sqlite3* db = connection.get();
        const auto query = spatial::prepare(db, fewest ? "SELECT RouteRow, Role, LinkRowid, NodeFrom, NodeTo, Cost FROM hops_net WHERE NodeFrom = ?1 AND NodeTo = ?2"
                                                       : "SELECT RouteRow, Role, LinkRowid, NodeFrom, NodeTo, Cost FROM roads_net WHERE NodeFrom = ?1 AND NodeTo = ?2");
        sqlite3_bind_int(query.get(), 1, from);
        sqlite3_bind_int(query.get(), 2, to);
        return spatial::ResultWriter(db).rows(query.get(), 1000);
    }

private:
    void rebuild() {
        build("SELECT CreateRouting('roads_data', 'roads_net', 'roads', 'node_from', 'node_to', 'geom', 'cost', NULL, 1, 1, NULL, NULL, 1)");
        build("SELECT CreateRouting('hops_data', 'hops_net', 'roads', 'node_from', 'node_to', 'geom', NULL, NULL, 1, 1, NULL, NULL, 1)");
    }

    // CreateRouting returns 1, or 0 with the reason in CreateRouting_GetLastError().
    void build(const char* sql) {
        sqlite3* db = connection.get();
        const auto network = spatial::prepare(db, sql);
        if (spatial::step(db, network.get()) && sqlite3_column_int(network.get(), 0) == 1) return;
        const auto reason = spatial::prepare(db, "SELECT CreateRouting_GetLastError()");
        spatial::step(db, reason.get());
        throw std::runtime_error("CreateRouting failed: " + spatial::text(reason.get(), 0));
    }

    spatial::Connection connection;
};

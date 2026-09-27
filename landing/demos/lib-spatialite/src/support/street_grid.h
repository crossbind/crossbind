#pragma once

// The street network the route planner generates, identical on every run: a grid of 20 by 20
// intersections, numbered row by row from 1 at (0, 0) to 400 at (19, 19), joined by unit-length
// two-way streets. Street ids come from their position: the east-going street from (col, row) is
// row * 19 + col + 1, the north-going one 380 + row * 20 + col + 1. Travel costs vary between 1 and
// 2 in quarter steps, and 42 streets are missing so the shortest path has to go around them.
namespace street_grid {

inline const char* const STREETS = R"sql(
SELECT InitSpatialMetaData(1, 'NONE');
CREATE TABLE streets (id INTEGER PRIMARY KEY, node_from INTEGER NOT NULL, node_to INTEGER NOT NULL, cost DOUBLE NOT NULL, geom BLOB NOT NULL);
WITH RECURSIVE r(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM r WHERE i < 19)
INSERT INTO streets (id, node_from, node_to, cost, geom)
SELECT y.i * 19 + x.i + 1, y.i * 20 + x.i + 1, y.i * 20 + x.i + 2, 1 + ((y.i * 31 + x.i * 17) % 5) / 4.0,
       MakeLine(MakePoint(x.i, y.i), MakePoint(x.i + 1, y.i))
FROM r AS y, r AS x WHERE x.i < 19 AND (y.i * 7 + x.i * 3 + 5) % 17 <> 0
UNION ALL
SELECT 380 + y.i * 20 + x.i + 1, y.i * 20 + x.i + 1, (y.i + 1) * 20 + x.i + 1, 1 + ((y.i * 13 + x.i * 29) % 5) / 4.0,
       MakeLine(MakePoint(x.i, y.i), MakePoint(x.i, y.i + 1))
FROM r AS y, r AS x WHERE y.i < 19 AND (y.i * 5 + x.i * 11 + 3) % 19 <> 0;
CREATE TABLE roads (id INTEGER PRIMARY KEY, node_from INTEGER NOT NULL, node_to INTEGER NOT NULL, cost DOUBLE NOT NULL);
SELECT AddGeometryColumn('roads', 'geom', 0, 'LINESTRING', 'XY');
INSERT INTO roads (id, node_from, node_to, cost, geom) SELECT id, node_from, node_to, cost, geom FROM streets;
)sql";

}  // namespace street_grid

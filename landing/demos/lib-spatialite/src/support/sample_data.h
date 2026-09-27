#pragma once

// The data the playground and the GeoPackage builder generate, identical on every run: 2,000 points
// of interest in clusters around twelve city centres, and a grid of hexagons half a degree across.
// Point i takes slot i % 20 of `slots`, so Istanbul, with six slots, gets 600 points. Its offset from
// the centre is a sum of two fractions of modular sequences, which piles the points up near the
// centre, up to 0.6 degrees east or west and 0.45 north or south.
namespace sample {

// The playground's database: registered geometry columns with spatial indexes, so SpatialIndex and
// KNN2 queries work on them.
inline const char* const PLAYGROUND = R"sql(
SELECT InitSpatialMetaData(1);
CREATE TEMP TABLE slots (slot INTEGER PRIMARY KEY, name TEXT NOT NULL, lon DOUBLE NOT NULL, lat DOUBLE NOT NULL);
INSERT INTO temp.slots VALUES
    (0, 'Istanbul', 28.9784, 41.0082), (1, 'Istanbul', 28.9784, 41.0082), (2, 'Istanbul', 28.9784, 41.0082),
    (3, 'Istanbul', 28.9784, 41.0082), (4, 'Istanbul', 28.9784, 41.0082), (5, 'Istanbul', 28.9784, 41.0082),
    (6, 'Ankara', 32.8597, 39.9334), (7, 'Ankara', 32.8597, 39.9334), (8, 'Ankara', 32.8597, 39.9334),
    (9, 'Izmir', 27.1428, 38.4237), (10, 'Izmir', 27.1428, 38.4237), (11, 'Bursa', 29.0610, 40.1885),
    (12, 'Antalya', 30.7133, 36.8969), (13, 'Adana', 35.3213, 37.0000), (14, 'Konya', 32.4846, 37.8746),
    (15, 'Gaziantep', 37.3833, 37.0662), (16, 'Kayseri', 35.4787, 38.7312), (17, 'Samsun', 36.3313, 41.2867),
    (18, 'Trabzon', 39.7168, 41.0027), (19, 'Diyarbakir', 40.2306, 37.9144);
CREATE TABLE cities (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
SELECT AddGeometryColumn('cities', 'geom', 4326, 'POINT', 'XY');
INSERT INTO cities (name, geom) SELECT name, MakePoint(lon, lat, 4326) FROM temp.slots GROUP BY name ORDER BY min(slot);
CREATE TABLE pois (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, city TEXT NOT NULL);
SELECT AddGeometryColumn('pois', 'geom', 4326, 'POINT', 'XY');
WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM seq WHERE i < 1999)
INSERT INTO pois (id, kind, city, geom)
SELECT i + 1, CASE i % 3 WHEN 0 THEN 'cafe' WHEN 1 THEN 'school' ELSE 'park' END, name,
       MakePoint(lon + ((i * 7919) % 10007 / 10007.0 + (i * 104729) % 10009 / 10009.0 - 1) * 0.6,
                 lat + ((i * 1299709) % 10037 / 10037.0 + (i * 15485863) % 10039 / 10039.0 - 1) * 0.45, 4326)
FROM seq JOIN temp.slots ON slot = i % 20;
SELECT CreateSpatialIndex('pois', 'geom');
CREATE TABLE hexagons (id INTEGER PRIMARY KEY);
SELECT AddGeometryColumn('hexagons', 'geom', 4326, 'POLYGON', 'XY');
WITH RECURSIVE grid(g) AS (SELECT HexagonalGrid(BuildMbr(25.5, 35.5, 41.5, 42.5, 4326), 0.5)),
     n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n, grid WHERE i < NumGeometries(g))
INSERT INTO hexagons (id, geom) SELECT i, GeometryN(g, i) FROM n, grid;
SELECT CreateSpatialIndex('hexagons', 'geom');
DROP TABLE temp.slots;
)sql";

// The same points and hexagons in an attached in-memory database named `sample`, as plain geometry
// blobs: the GeoPackage builder copies them into its layers and leaves no SpatiaLite metadata in the
// file it writes.
inline const char* const ATTACHED = R"sql(
ATTACH DATABASE ':memory:' AS sample;
CREATE TABLE sample.slots (slot INTEGER PRIMARY KEY, name TEXT NOT NULL, lon DOUBLE NOT NULL, lat DOUBLE NOT NULL);
INSERT INTO sample.slots VALUES
    (0, 'Istanbul', 28.9784, 41.0082), (1, 'Istanbul', 28.9784, 41.0082), (2, 'Istanbul', 28.9784, 41.0082),
    (3, 'Istanbul', 28.9784, 41.0082), (4, 'Istanbul', 28.9784, 41.0082), (5, 'Istanbul', 28.9784, 41.0082),
    (6, 'Ankara', 32.8597, 39.9334), (7, 'Ankara', 32.8597, 39.9334), (8, 'Ankara', 32.8597, 39.9334),
    (9, 'Izmir', 27.1428, 38.4237), (10, 'Izmir', 27.1428, 38.4237), (11, 'Bursa', 29.0610, 40.1885),
    (12, 'Antalya', 30.7133, 36.8969), (13, 'Adana', 35.3213, 37.0000), (14, 'Konya', 32.4846, 37.8746),
    (15, 'Gaziantep', 37.3833, 37.0662), (16, 'Kayseri', 35.4787, 38.7312), (17, 'Samsun', 36.3313, 41.2867),
    (18, 'Trabzon', 39.7168, 41.0027), (19, 'Diyarbakir', 40.2306, 37.9144);
CREATE TABLE sample.pois (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, city TEXT NOT NULL, geom BLOB NOT NULL);
WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM seq WHERE i < 1999)
INSERT INTO sample.pois (id, kind, city, geom)
SELECT i + 1, CASE i % 3 WHEN 0 THEN 'cafe' WHEN 1 THEN 'school' ELSE 'park' END, name,
       MakePoint(lon + ((i * 7919) % 10007 / 10007.0 + (i * 104729) % 10009 / 10009.0 - 1) * 0.6,
                 lat + ((i * 1299709) % 10037 / 10037.0 + (i * 15485863) % 10039 / 10039.0 - 1) * 0.45, 4326)
FROM seq JOIN sample.slots ON slot = i % 20;
CREATE TABLE sample.hexagons (id INTEGER PRIMARY KEY, geom BLOB NOT NULL);
WITH RECURSIVE grid(g) AS (SELECT HexagonalGrid(BuildMbr(25.5, 35.5, 41.5, 42.5, 4326), 0.5)),
     n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n, grid WHERE i < NumGeometries(g))
INSERT INTO sample.hexagons (id, geom) SELECT i, GeometryN(g, i) FROM n, grid;
)sql";

}  // namespace sample

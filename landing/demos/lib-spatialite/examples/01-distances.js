export const title = 'Store points and measure the distance between them';
export const summary =
    'The calls every SpatiaLite program starts with: `spatialite_alloc_connection` and `spatialite_init_ex` register the spatial SQL functions on a SQLite connection, `InitSpatialMetaData` creates the metadata tables and `AddGeometryColumn` adds a geometry column. `GeomFromText` reads WKT, and `ST_Distance(a, b, 1)` measures on the WGS 84 ellipsoid.';
export const native = 'spatial_database.h';
export const expected = ['5.1.0 3', 'Istanbul 0 km, Izmir 327 km, Ankara 350 km'];

export default async function example({ SpatialDatabase }, console) {
    const db = await new SpatialDatabase();
    await db.exec(`
        SELECT InitSpatialMetaData(1, 'WGS84');
        CREATE TABLE cities (name TEXT NOT NULL);
        SELECT AddGeometryColumn('cities', 'geom', 4326, 'POINT', 'XY');
        INSERT INTO cities (name, geom) VALUES
            ('Istanbul', GeomFromText('POINT(28.9784 41.0082)', 4326)),
            ('Ankara', GeomFromText('POINT(32.8597 39.9334)', 4326)),
            ('Izmir', GeomFromText('POINT(27.1428 38.4237)', 4326));
    `);
    console.log(await SpatialDatabase.version(), await db.scalar('SELECT count(*) FROM cities'));
    console.log(await db.scalar(`
        SELECT group_concat(name || ' ' || km || ' km', ', ' ORDER BY km)
        FROM (SELECT name, CAST(Round(ST_Distance(geom, MakePoint(28.9784, 41.0082, 4326), 1) / 1000) AS INTEGER) AS km FROM cities)
    `));
}

export const imports = {
    '@crossbind/port-proj/geodesic.h': [
        'geod_geodesic',
        'geod_init',
        'geod_inverse',
        'geod_direct',
        'geod_polygonarea',
        'allocBuffer',
        'writeNumberAt',
        'readNumberAt',
    ],
};
export const note = '`struct geod_geodesic` is bound as a class: `new geod_geodesic()` allocates one and `geod_init` fills it in, so JavaScript needs none of its fields. Every result comes back through a `double *` out-parameter, an 8-byte `allocBuffer` read with `readNumberAt` (`null` skips one), and the corners of the polygon go in as two `double` arrays written with `writeNumberAt`.';
export const expected = ['8080.310 km, leaving on 309.12°, arriving on 230.50°', 'halfway at 54.1948, -22.5976', '1145170.4 km², perimeter 4868.1 km'];

export default async function example({ geod_geodesic, geod_init, geod_inverse, geod_direct, geod_polygonarea, allocBuffer, writeNumberAt, readNumberAt }, console) {
    const wgs84 = await new geod_geodesic();
    await geod_init(wgs84, 6378137, 1 / 298.257223563); // the WGS 84 ellipsoid
    const read = async (slot) => readNumberAt(slot, 0, 'float64');
    const compass = (azimuth) => ((azimuth + 360) % 360).toFixed(2);

    const distance = await allocBuffer(8); // double * out-parameters
    const azimuth1 = await allocBuffer(8);
    const azimuth2 = await allocBuffer(8);
    await geod_inverse(wgs84, 41.0082, 28.9784, 40.6413, -73.7781, distance, azimuth1, azimuth2); // Istanbul to New York JFK
    const [meters, departure, arrival] = [await read(distance), await read(azimuth1), await read(azimuth2)];
    console.log(`${(meters / 1000).toFixed(3)} km, leaving on ${compass(departure)}°, arriving on ${compass(arrival)}°`);
    const lat2 = await allocBuffer(8);
    const lon2 = await allocBuffer(8);
    await geod_direct(wgs84, 41.0082, 28.9784, departure, meters / 2, lat2, lon2, null);
    console.log(`halfway at ${(await read(lat2)).toFixed(4)}, ${(await read(lon2)).toFixed(4)}`); // far north of both cities

    const triangle = [[25.7617, -80.1918], [18.4655, -66.1057], [32.3078, -64.7505]]; // Miami, San Juan, Bermuda
    const lats = await allocBuffer(triangle.length * 8);
    const lons = await allocBuffer(triangle.length * 8);
    for (const [index, [lat, lon]] of triangle.entries()) {
        await writeNumberAt(lats, index, 'float64', lat);
        await writeNumberAt(lons, index, 'float64', lon);
    }
    const area = await allocBuffer(8);
    const perimeter = await allocBuffer(8);
    await geod_polygonarea(wgs84, lats, lons, triangle.length, area, perimeter);
    console.log(`${((await read(area)) / 1e6).toFixed(1)} km², perimeter ${((await read(perimeter)) / 1000).toFixed(1)} km`);
}

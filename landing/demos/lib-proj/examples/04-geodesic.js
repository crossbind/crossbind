export const title = 'Measure distances, headings and areas on the ellipsoid';
export const summary = "geod_inverse gives the shortest route between two points on the WGS 84 ellipsoid and its headings, geod_direct where a heading and a distance lead, and geod_polygonarea the area of a polygon. This is GeographicLib's algorithm, part of PROJ; it needs no CRS and no proj.db.";
export const native = 'geodesy.h';
export const expected = ['8080.310 km, leaving on 309.12°, arriving on 230.50°', 'halfway at 54.1948, -22.5976', '1145170.4 km², perimeter 4868.1 km'];

export default async function example({ Geodesy }, console) {
    const compass = (azimuth) => ((azimuth + 360) % 360).toFixed(2);
    const [meters, departure, arrival] = JSON.parse(await Geodesy.inverse(41.0082, 28.9784, 40.6413, -73.7781)); // Istanbul to New York JFK
    console.log(`${(meters / 1000).toFixed(3)} km, leaving on ${compass(departure)}°, arriving on ${compass(arrival)}°`);
    const [lat, lon] = JSON.parse(await Geodesy.direct(41.0082, 28.9784, departure, meters / 2));
    console.log(`halfway at ${lat.toFixed(4)}, ${lon.toFixed(4)}`); // far north of both cities
    const triangle = [[25.7617, -80.1918], [18.4655, -66.1057], [32.3078, -64.7505]]; // Miami, San Juan, Bermuda
    const [m2, perimeter] = JSON.parse(await Geodesy.area(JSON.stringify(triangle)));
    console.log(`${(m2 / 1e6).toFixed(1)} km², perimeter ${(perimeter / 1000).toFixed(1)} km`);
}

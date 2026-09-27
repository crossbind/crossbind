export const title = 'Find places in a map view and the nearest ones with a spatial index';
export const summary =
    '`CreateSpatialIndex` keeps an R*Tree of the bounding boxes of a geometry column, and queries reach it through virtual tables: `SpatialIndex` returns the rows inside a box such as the map view, and `KNN2` the rows nearest to a point with their distance in metres.';
export const native = 'place_index.h';
export const expected = ['Bursa, Edirne, Istanbul, Izmir', 'Bursa 133 km, Istanbul 189 km, Ankara 201 km'];

export default async function example({ PlaceIndex }, console) {
    const places = await new PlaceIndex();
    const cities = [
        ['Istanbul', 28.9784, 41.0082],
        ['Ankara', 32.8597, 39.9334],
        ['Izmir', 27.1428, 38.4237],
        ['Bursa', 29.061, 40.1885],
        ['Antalya', 30.7133, 36.8969],
        ['Trabzon', 39.7168, 41.0027],
        ['Konya', 32.4846, 37.8746],
        ['Edirne', 26.5557, 41.6771],
    ];
    for (const [name, lon, lat] of cities) await places.add(name, lon, lat);
    console.log(await places.inView(26, 38, 31, 42));
    const eskisehir = [30.5206, 39.7767];
    console.log(await places.nearest(...eskisehir, 3, 5));
}

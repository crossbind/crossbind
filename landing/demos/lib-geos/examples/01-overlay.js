export const title = 'Intersect, unite and subtract two polygons';
export const summary = 'Overlay is the most used part of GEOS: GEOSIntersection_r, GEOSUnion_r and GEOSDifference_r on shapes read from WKT, with GEOSArea_r to measure the result.';
export const native = 'overlay.h';
export const expected = ['3.15.0-CAPI-1.21.0', 'POLYGON ((5 5, 5 10, 10 10, 10 5, 5 5)) 25', '175 75'];

export default async function example({ Overlay }, console) {
    const parcel = 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))';
    const floodZone = 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))';
    const flooded = await Overlay.intersection(parcel, floodZone);
    console.log(await Overlay.version());
    console.log(flooded, await Overlay.area(flooded));
    console.log(await Overlay.area(await Overlay.unite(parcel, floodZone)), await Overlay.area(await Overlay.difference(parcel, floodZone)));
}

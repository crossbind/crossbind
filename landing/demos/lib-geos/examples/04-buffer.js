export const title = 'Buffer points, lines and polygons';
export const summary = "GEOSBuffer_r turns a point into a circle of straight segments, GEOSBufferWithStyle_r sets the caps and joins of a line's corridor, a negative distance shrinks a polygon, and GEOSOffsetCurve_r draws a parallel line.";
export const native = 'buffer.h';
export const expected = ['312.1445', '1000 1078.0361', 'POLYGON ((2 2, 2 18, 18 18, 18 2, 2 2)) 256', 'LINESTRING (0 5, 100 5)'];

export default async function example({ BufferOp, Measure }, console) {
    const circle = await BufferOp.around('POINT (0 0)', 10, 8); // 8 segments per quarter circle
    console.log((await Measure.area(circle)).toFixed(4));
    const road = 'LINESTRING (0 0, 100 0)';
    const flat = await BufferOp.withStyle(road, 5, 'flat', 'round');
    const round = await BufferOp.withStyle(road, 5, 'round', 'round');
    console.log(await Measure.area(flat), (await Measure.area(round)).toFixed(4));
    const setback = await BufferOp.around('POLYGON ((0 0, 20 0, 20 20, 0 20, 0 0))', -2, 8);
    console.log(setback, await Measure.area(setback));
    console.log(await BufferOp.offsetCurve(road, 5));
}

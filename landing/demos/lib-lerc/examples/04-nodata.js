export const title = 'Leave out pixels that have no data';
export const summary = 'Rasters mark gaps with a NoData value such as -9999. Stored as a height, it stretches the value range of every block it lands in. Passed as the validity mask (`pValidBytes` in `lerc_encode` and `lerc_decode`), it costs at most a bit per pixel, and decoding hands the mask back.';
export const native = 'lerc_nodata.h';
export const expected = ['-9999 stored as a height: 147759 B', '-9999 as missing pixels: 98308 B', '1273 gaps come back as -9999, largest error elsewhere 0.0099 m'];

export default async function example({ LercCodec, LercNoData }, console) {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const heights = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - 128;
            const dy = y - 128;
            heights[y * width + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000;
        }
    }
    for (let i = 0; i < heights.length; i += 1) if (random(50) === 0) heights[i] = -9999; // the survey missed 2% of its points
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));
    const text = toText(new Uint8Array(heights.buffer));

    const asHeight = await LercCodec.encode(text, width, height, 0.01); // the codec from the first example
    const blob = await LercNoData.encode(text, width, height, -9999, 0.01);
    const back = new Float32Array(toBytes(await LercNoData.decode(blob, -9999)).buffer);
    let gaps = 0;
    let worst = 0;
    for (let i = 0; i < heights.length; i += 1) {
        if (heights[i] === -9999) gaps += back[i] === -9999 ? 1 : 0;
        else worst = Math.max(worst, Math.abs(back[i] - heights[i]));
    }
    console.log(`-9999 stored as a height: ${asHeight.length} B`);
    console.log(`-9999 as missing pixels: ${blob.length} B`);
    console.log(`${gaps} gaps come back as -9999, largest error elsewhere ${worst.toFixed(4)} m`);
}

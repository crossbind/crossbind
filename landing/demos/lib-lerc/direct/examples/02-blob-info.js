export const imports = {
    '@crossbind/port-lerc/Lerc_c_api.h': [
        'lerc_computeCompressedSize',
        'lerc_encode',
        'lerc_getBlobInfo',
        'allocBuffer',
        'writeBytes',
        'readNumberAt',
    ],
};
export const note = 'What the C++ wrapper packed into JSON, JavaScript reads straight from the two arrays `lerc_getBlobInfo` fills: an `unsigned int[11]` and a `double[3]` it allocates itself and reads one number at a time with `readNumberAt`, in the order of `InfoArrOrder` and `DataRangeArrOrder` in `Lerc_types.h`. Both lines print as in the C++ version.';
export const expected = ['Lerc2 v6: 256x256, 1 band of float32, 65536 valid pixels, 67591 B', 'heights 1032.268 to 1500.945 m, stored within 0.099878 m'];

export default async function example({ lerc_computeCompressedSize, lerc_encode, lerc_getBlobInfo, allocBuffer, writeBytes, readNumberAt }, console) {
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
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const check = (status) => {
        if (status !== 0) throw new Error(`LERC failed with status ${status}`);
    };
    const FLOAT = 6; // dt_float in Lerc_types.h

    // Encoded as in the first example, within 10 cm less one float32 step.
    const largest = heights.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const maxZErr = 0.1 - 2 ** (Math.floor(Math.log2(largest)) - 23);
    const data = await allocBuffer(heights.byteLength);
    await writeBytes(data, toText(new Uint8Array(heights.buffer)));
    const size = await allocBuffer(4);
    check(await lerc_computeCompressedSize(data, FLOAT, 1, width, height, 1, 0, null, maxZErr, size));
    const capacity = await readNumberAt(size, 0, 'uint32');
    const blob = await allocBuffer(capacity);
    check(await lerc_encode(data, FLOAT, 1, width, height, 1, 0, null, maxZErr, blob, capacity, size));

    const infoArray = await allocBuffer(11 * 4); // unsigned int[11], in the order of InfoArrOrder in Lerc_types.h
    const rangeArray = await allocBuffer(3 * 8); // double[3]: zMin, zMax, maxZErrUsed
    check(await lerc_getBlobInfo(blob, await readNumberAt(size, 0, 'uint32'), infoArray, rangeArray, 11, 3));
    const info = [];
    for (let i = 0; i < 11; i += 1) info.push(await readNumberAt(infoArray, i, 'uint32'));
    const range = [];
    for (let i = 0; i < 3; i += 1) range.push(await readNumberAt(rangeArray, i, 'float64'));
    const [version, dataType, , columns, rows, bands, validPixels, blobSize] = info;
    const [zMin, zMax, maxZErrUsed] = range;
    const types = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'];
    console.log(`${version === 0 ? 'Lerc1' : `Lerc2 v${version}`}: ${columns}x${rows}, ${bands} band of ${types[dataType]}, ${validPixels} valid pixels, ${blobSize} B`);
    console.log(`heights ${zMin.toFixed(3)} to ${zMax.toFixed(3)} m, stored within ${maxZErrUsed.toFixed(6)} m`);
}

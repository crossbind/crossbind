export const imports = {
    '@crossbind/port-lerc/Lerc_c_api.h': [
        'lerc_computeCompressedSize',
        'lerc_encode',
        'lerc_decode',
        'allocBuffer',
        'writeBytes',
        'readBytes',
        'readNumberAt',
    ],
};
export const note = 'The same `lerc_computeCompressedSize`, `lerc_encode` and `lerc_decode` calls the C++ codec makes. JavaScript now allocates every buffer, copies the float32 bytes in and out as one character per byte, reads the `unsigned int` blob size back with `readNumberAt` and works out the error bound, one float32 step under 1 cm, itself. LERC has its version only as the `LERC_VERSION_MAJOR`, `LERC_VERSION_MINOR` and `LERC_VERSION_PATCH` macros, which the binding does not export, so the first line has no version.';
export const expected = ['LERC: 262144 B of float32 heights -> 94775 B', 'largest error 0.0099 m, within 1 cm: true'];

export default async function example({ lerc_computeCompressedSize, lerc_encode, lerc_decode, allocBuffer, writeBytes, readBytes, readNumberAt }, console) {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const heights = new Float32Array(width * height); // metres, row by row from the top left
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - 128;
            const dy = y - 128;
            heights[y * width + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000; // a hill, rough to 1 m
        }
    }
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));
    const check = (status) => {
        if (status !== 0) throw new Error(`LERC failed with status ${status}`);
    };
    const FLOAT = 6; // dt_float in Lerc_types.h

    // LERC rounds back to float32 and can overshoot maxZErr by half a float32 step: ask for one step less.
    const largest = heights.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const maxZErr = 0.01 - 2 ** (Math.floor(Math.log2(largest)) - 23);
    const data = await allocBuffer(heights.byteLength);
    await writeBytes(data, toText(new Uint8Array(heights.buffer)));
    const size = await allocBuffer(4); // the unsigned int both calls write back
    check(await lerc_computeCompressedSize(data, FLOAT, 1, width, height, 1, 0, null, maxZErr, size));
    const capacity = await readNumberAt(size, 0, 'uint32');
    const blob = await allocBuffer(capacity);
    check(await lerc_encode(data, FLOAT, 1, width, height, 1, 0, null, maxZErr, blob, capacity, size));
    const blobSize = await readNumberAt(size, 0, 'uint32');

    const values = await allocBuffer(heights.byteLength);
    check(await lerc_decode(blob, blobSize, 0, null, 1, width, height, 1, FLOAT, values));
    const decoded = new Float32Array(toBytes(await readBytes(values, heights.byteLength)).buffer);
    let worst = 0;
    for (let i = 0; i < heights.length; i += 1) worst = Math.max(worst, Math.abs(decoded[i] - heights[i]));
    console.log(`LERC: ${heights.byteLength} B of float32 heights -> ${blobSize} B`);
    console.log(`largest error ${worst.toFixed(4)} m, within 1 cm: ${worst <= 0.01}`);
}

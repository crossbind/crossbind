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
export const note = 'JavaScript builds the validity mask itself, a byte per pixel written with `writeBytes`, and `lerc_decode` fills a second one on the way back. Missing pixels decode as 0, so putting -9999 back is a JavaScript loop, and the error bound, one float32 step under 1 cm at the largest value each encode stores, is worked out in JavaScript too.';
export const expected = ['-9999 stored as a height: 147759 B', '-9999 as missing pixels: 98308 B', '1273 gaps come back as -9999, largest error elsewhere 0.0099 m'];

export default async function example({ lerc_computeCompressedSize, lerc_encode, lerc_decode, allocBuffer, writeBytes, readBytes, readNumberAt }, console) {
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
    const check = (status) => {
        if (status !== 0) throw new Error(`LERC failed with status ${status}`);
    };
    const FLOAT = 6; // dt_float in Lerc_types.h

    const data = await allocBuffer(heights.byteLength);
    await writeBytes(data, toText(new Uint8Array(heights.buffer)));
    const valid = await allocBuffer(heights.length); // the mask: a byte per pixel, 1 valid, 0 missing
    await writeBytes(valid, toText(Uint8Array.from(heights, (value) => (value === -9999 ? 0 : 1))));
    const size = await allocBuffer(4);
    // LERC rounds back to float32 and can overshoot maxZErr by half a float32 step: ask for one step
    // less at the largest value it stores.
    const encode = async (nMasks, mask, largest) => {
        const maxZErr = 0.01 - 2 ** (Math.floor(Math.log2(largest)) - 23);
        check(await lerc_computeCompressedSize(data, FLOAT, 1, width, height, 1, nMasks, mask, maxZErr, size));
        const capacity = await readNumberAt(size, 0, 'uint32');
        const blob = await allocBuffer(capacity);
        check(await lerc_encode(data, FLOAT, 1, width, height, 1, nMasks, mask, maxZErr, blob, capacity, size));
        return [blob, await readNumberAt(size, 0, 'uint32')];
    };
    const largestOf = (values) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const [, asHeightSize] = await encode(0, null, largestOf(heights));
    const [blob, blobSize] = await encode(1, valid, largestOf(heights.filter((value) => value !== -9999)));

    const values = await allocBuffer(heights.byteLength);
    const mask = await allocBuffer(heights.length);
    check(await lerc_decode(blob, blobSize, 1, mask, 1, width, height, 1, FLOAT, values));
    const back = new Float32Array(toBytes(await readBytes(values, heights.byteLength)).buffer);
    const validBack = toBytes(await readBytes(mask, heights.length));
    let gaps = 0;
    let worst = 0;
    for (let i = 0; i < heights.length; i += 1) {
        if (validBack[i] === 0) back[i] = -9999; // missing pixels decode as 0: put the NoData value back
        if (heights[i] === -9999) gaps += back[i] === -9999 ? 1 : 0;
        else worst = Math.max(worst, Math.abs(back[i] - heights[i]));
    }
    console.log(`-9999 stored as a height: ${asHeightSize} B`);
    console.log(`-9999 as missing pixels: ${blobSize} B`);
    console.log(`${gaps} gaps come back as -9999, largest error elsewhere ${worst.toFixed(4)} m`);
}

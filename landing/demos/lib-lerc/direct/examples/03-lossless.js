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
export const note = 'A `maxZErr` of 0 through the same three calls, with data type 3 (`dt_ushort`), and the 16-bit values cross as their bytes. The C++ decoder read the type and the size from the blob header so it could decode any blob; this one already knows them and passes them straight to `lerc_decode`.';
export const expected = ['uint16, 256x256: 131072 B -> 59091 B', 'identical: true'];

export default async function example({ lerc_computeCompressedSize, lerc_encode, lerc_decode, allocBuffer, writeBytes, readBytes, readNumberAt }, console) {
    let seed = 7;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const band = new Uint16Array(width * height); // a gradient plus sensor noise, 12-bit values
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) band[y * width + x] = 1800 + ((x + y) >> 1) + random(64);
    }
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));
    const check = (status) => {
        if (status !== 0) throw new Error(`LERC failed with status ${status}`);
    };
    const USHORT = 3; // dt_ushort in Lerc_types.h

    const data = await allocBuffer(band.byteLength);
    await writeBytes(data, toText(new Uint8Array(band.buffer)));
    const size = await allocBuffer(4);
    check(await lerc_computeCompressedSize(data, USHORT, 1, width, height, 1, 0, null, 0, size)); // maxZErr 0: lossless
    const capacity = await readNumberAt(size, 0, 'uint32');
    const blob = await allocBuffer(capacity);
    check(await lerc_encode(data, USHORT, 1, width, height, 1, 0, null, 0, blob, capacity, size));
    const blobSize = await readNumberAt(size, 0, 'uint32');

    const values = await allocBuffer(band.byteLength);
    check(await lerc_decode(blob, blobSize, 0, null, 1, width, height, 1, USHORT, values));
    const back = new Uint16Array(toBytes(await readBytes(values, band.byteLength)).buffer);
    console.log(`uint16, ${width}x${height}: ${band.byteLength} B -> ${blobSize} B`);
    console.log(`identical: ${back.length === band.length && back.every((value, i) => value === band[i])}`);
}

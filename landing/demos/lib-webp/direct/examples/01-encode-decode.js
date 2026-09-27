export const imports = {
    '@crossbind/port-webp/webp/encode.h': [
        'WebPGetEncoderVersion',
        'WebPEncodeRGBA',
        'WebPEncodeLosslessRGBA',
        'allocBuffer',
        'allocPointer',
        'readPointerAt',
        'readNumberAt',
        'readBytes',
        'writeBytes',
    ],
    '@crossbind/port-webp/webp/decode.h': ['WebPGetInfo', 'WebPDecodeRGBA'],
    '@crossbind/port-webp/webp/types.h': ['WebPFree'],
};
export const note = 'The same four calls on the headers libwebp ships; what the C++ did for you is now yours. Pixels go in through `allocBuffer` and `writeBytes`, the encoders hand their bytes back through a `uint8_t **` (an `allocPointer(1)` slot read with `readPointerAt`), `WebPGetInfo` writes the size into two `allocBuffer(4)` ints, and everything libwebp allocated goes back through `WebPFree` from `types.h`. `WebPGetEncoderVersion` packs the version into one integer, 0xMMmmpp.';
export const expected = ['1.6.0 256x256', 'RGBA 262144 B -> lossy q80 1966 B, lossless 87058 B', 'true'];

export default async function example({ WebPGetEncoderVersion, WebPEncodeRGBA, WebPEncodeLosslessRGBA, allocBuffer, allocPointer, readPointerAt, readNumberAt, readBytes, writeBytes, WebPGetInfo, WebPDecodeRGBA, WebPFree }, console) {
    let seed = 1;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    let rgba = '';
    for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
            const sun = (x - 180) ** 2 + (y - 70) ** 2 < 900;
            const hill = y > 170 + (((x - 128) ** 2) >> 8);
            const [r, g, b] = sun ? [255, 214, 90] : hill ? [40 + (y >> 2), 120 + (x >> 3), 50] : [90 + (y >> 1), 150 + (y >> 2), 235];
            rgba += String.fromCharCode(r ^ random(8), g ^ random(8), b ^ random(8), 255);
        }
    }

    const pixels = await allocBuffer(rgba.length);
    await writeBytes(pixels, rgba);
    const output = await allocPointer(1);
    const lossySize = await WebPEncodeRGBA(pixels, 256, 256, 256 * 4, 80, output);
    const lossy = await readPointerAt(output, 0);
    const losslessSize = await WebPEncodeLosslessRGBA(pixels, 256, 256, 256 * 4, output);
    const lossless = await readPointerAt(output, 0);
    if (!lossySize || !losslessSize) throw new Error('WebP encoding failed');

    const version = await WebPGetEncoderVersion();
    const width = await allocBuffer(4);
    const height = await allocBuffer(4);
    if (!(await WebPGetInfo(lossy, lossySize, width, height))) throw new Error('not a WebP image');
    console.log(`${version >> 16}.${(version >> 8) & 255}.${version & 255}`, `${await readNumberAt(width, 0, 'int32')}x${await readNumberAt(height, 0, 'int32')}`);
    console.log(`RGBA ${rgba.length} B -> lossy q80 ${lossySize} B, lossless ${losslessSize} B`);

    const decoded = await WebPDecodeRGBA(lossless, losslessSize, width, height);
    if (!decoded) throw new Error('not a decodable WebP image');
    console.log((await readBytes(decoded, rgba.length)) === rgba);
    await Promise.all([WebPFree(lossy), WebPFree(lossless), WebPFree(decoded)]);
}

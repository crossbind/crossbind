export const imports = {
    '@crossbind/port-zstd/zstd.h': [
        'ZSTD_versionString',
        'ZSTD_compressBound',
        'ZSTD_compress',
        'ZSTD_isError',
        'ZSTD_getErrorName',
        'ZSTD_getFrameContentSize',
        'ZSTD_decompress',
        'allocBuffer',
        'writeBytes',
        'readBytes',
    ],
};
export const note = 'The same two calls on `zstd.h` as zstd ships it. What the C++ did for you is now yours: size and allocate each buffer (`allocBuffer` memory is released with its handle), copy bytes in and out as one character per byte, and check every return with `ZSTD_isError`. `ZSTD_getFrameContentSize` returns an `unsigned long long`, so it arrives as a BigInt.';
export const expected = ['1.5.7 27 28 b5 2f fd', 'true'];

export default async function example({ ZSTD_versionString, ZSTD_compressBound, ZSTD_compress, ZSTD_isError, ZSTD_getErrorName, ZSTD_getFrameContentSize, ZSTD_decompress, allocBuffer, writeBytes, readBytes }, console) {
    const text = 'crossbind '.repeat(100);
    const source = await allocBuffer(text.length);
    await writeBytes(source, text);
    const bound = await ZSTD_compressBound(text.length);
    const frame = await allocBuffer(bound);
    const size = await ZSTD_compress(frame, bound, source, text.length, 19);
    if (await ZSTD_isError(size)) throw new Error(await ZSTD_getErrorName(size));
    const head = await readBytes(frame, 4);
    console.log(await ZSTD_versionString(), size, [...head].map((c) => c.charCodeAt(0).toString(16)).join(' '));

    const length = Number(await ZSTD_getFrameContentSize(frame, size));
    const copy = await allocBuffer(length);
    const written = await ZSTD_decompress(copy, length, frame, size);
    console.log((await readBytes(copy, written)) === text);
}

export const imports = {
    '@crossbind/port-zlib/zlib.h': [
        'zlibVersion',
        'compressBound',
        'compress2',
        'uncompress',
        'zError',
        'allocBuffer',
        'writeBytes',
        'readBytes',
        'writeNumberAt',
        'readNumberAt',
    ],
};
export const note = 'The same `compress2` and `uncompress` calls as the C++. JavaScript now allocates the buffers, copies bytes in and out as one character per byte, and passes each length as a `uLongf *`: a 4-byte handle that zlib reads as the room it has and overwrites with the size it used. `Z_OK` and zlib\'s other constants are macros, which do not cross, so the check compares with 0.';
export const expected = ['1.3.2 27 78 da', 'true'];

export default async function example({ zlibVersion, compressBound, compress2, uncompress, zError, allocBuffer, writeBytes, readBytes, writeNumberAt, readNumberAt }, console) {
    const text = 'crossbind '.repeat(100);
    const source = await allocBuffer(text.length);
    await writeBytes(source, text);
    const bound = await compressBound(text.length);
    const packed = await allocBuffer(bound);
    const destLen = await allocBuffer(4);
    await writeNumberAt(destLen, 0, 'uint32', bound);
    const status = await compress2(packed, destLen, source, text.length, 9);
    if (status !== 0) throw new Error(await zError(status));
    const size = await readNumberAt(destLen, 0, 'uint32');
    const head = await readBytes(packed, 2);
    console.log(await zlibVersion(), size, [...head].map((c) => c.charCodeAt(0).toString(16)).join(' '));

    const copy = await allocBuffer(text.length);
    await writeNumberAt(destLen, 0, 'uint32', text.length);
    const result = await uncompress(copy, destLen, packed, size);
    if (result !== 0) throw new Error(await zError(result));
    console.log((await readBytes(copy, await readNumberAt(destLen, 0, 'uint32'))) === text);
}

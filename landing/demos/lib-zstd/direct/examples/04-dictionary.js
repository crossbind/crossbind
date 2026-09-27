export const imports = {
    '@crossbind/port-zstd/zdict.h': ['ZDICT_trainFromBuffer', 'ZDICT_isError', 'ZDICT_getErrorName'],
    '@crossbind/port-zstd/zstd.h': [
        'ZSTD_createCDict',
        'ZSTD_freeCDict',
        'ZSTD_createDDict',
        'ZSTD_freeDDict',
        'ZSTD_createCCtx',
        'ZSTD_freeCCtx',
        'ZSTD_createDCtx',
        'ZSTD_freeDCtx',
        'ZSTD_compress_usingCDict',
        'ZSTD_decompress_usingDDict',
        'ZSTD_compress',
        'ZSTD_compressBound',
        'allocBuffer',
        'writeBytes',
        'readBytes',
    ],
};
export const note = '`ZDICT_trainFromBuffer` takes the sample sizes as a `size_t` array, written here as little-endian 32-bit numbers because `size_t` is 4 bytes in wasm32 (8 on a 64-bit phone). Contexts and dictionaries are freed by hand.';
export const expected = ['dictionary: 2048 B', '59 B message: 68 B alone, 29 B with the dictionary', 'true'];

export default async function example({ ZDICT_trainFromBuffer, ZDICT_isError, ZDICT_getErrorName, ZSTD_createCDict, ZSTD_freeCDict, ZSTD_createDDict, ZSTD_freeDDict, ZSTD_createCCtx, ZSTD_freeCCtx, ZSTD_createDCtx, ZSTD_freeDCtx, ZSTD_compress_usingCDict, ZSTD_decompress_usingDDict, ZSTD_compress, ZSTD_compressBound, allocBuffer, writeBytes, readBytes }, console) {
    const event = (i) => `{"event":"click","user":${1000 + ((i * 37) % 900)},"page":"/products/${i % 12}","ms":${(i * 7919) % 400}}`;
    const samples = Array.from({ length: 4000 }, (_, i) => event(i));
    const joined = await allocBuffer(samples.join('').length);
    await writeBytes(joined, samples.join(''));
    const uint32 = (n) => String.fromCharCode(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24);
    const sizes = await allocBuffer(samples.length * 4);
    await writeBytes(sizes, samples.map((sample) => uint32(sample.length)).join(''));
    const dictionary = await allocBuffer(2048);
    const size = await ZDICT_trainFromBuffer(dictionary, 2048, joined, sizes, samples.length);
    if (await ZDICT_isError(size)) throw new Error(await ZDICT_getErrorName(size));
    const cdict = await ZSTD_createCDict(dictionary, size, 3);
    const ddict = await ZSTD_createDDict(dictionary, size);
    const cctx = await ZSTD_createCCtx();
    const dctx = await ZSTD_createDCtx();

    const message = event(4321);
    const source = await allocBuffer(message.length);
    await writeBytes(source, message);
    const bound = await ZSTD_compressBound(message.length);
    const frame = await allocBuffer(bound);
    const alone = await ZSTD_compress(frame, bound, source, message.length, 3);
    const compressed = await ZSTD_compress_usingCDict(cctx, frame, bound, source, message.length, cdict);
    const copy = await allocBuffer(message.length);
    const written = await ZSTD_decompress_usingDDict(dctx, copy, message.length, frame, compressed, ddict);
    console.log(`dictionary: ${size} B`);
    console.log(`${message.length} B message: ${alone} B alone, ${compressed} B with the dictionary`);
    console.log((await readBytes(copy, written)) === message);
    await Promise.all([ZSTD_freeCCtx(cctx), ZSTD_freeDCtx(dctx), ZSTD_freeCDict(cdict), ZSTD_freeDDict(ddict)]);
}

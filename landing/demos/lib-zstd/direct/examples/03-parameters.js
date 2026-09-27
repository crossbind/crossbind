export const imports = {
    '@crossbind/port-zstd/zstd.h': [
        'ZSTD_createCCtx',
        'ZSTD_freeCCtx',
        'ZSTD_CCtx_setParameter',
        'ZSTD_cParameter',
        'ZSTD_compress2',
        'ZSTD_compressBound',
        'ZSTD_isError',
        'ZSTD_getErrorName',
        'ZSTD_getFrameContentSize',
        'allocBuffer',
        'writeBytes',
    ],
};
export const note = 'Setting parameters and compressing work the same way; enum values cross one member at a time (`await ZSTD_cParameter.ZSTD_c_windowLog`). Reading the choices back does not: `ZSTD_getFrameHeader` is behind `ZSTD_STATIC_LINKING_ONLY`, so JavaScript gets the content size but not the window or the checksum flag.';
export const expected = [
    'level 3: 16160 B -> 3065 B',
    'level 9: 16160 B -> 2749 B',
    'level 19: 16160 B -> 2219 B',
    'level 19, 1 KiB window, checksum: 2469 B',
    'content 16160 B',
];

export default async function example({ ZSTD_createCCtx, ZSTD_freeCCtx, ZSTD_CCtx_setParameter, ZSTD_cParameter, ZSTD_compress2, ZSTD_compressBound, ZSTD_isError, ZSTD_getErrorName, ZSTD_getFrameContentSize, allocBuffer, writeBytes }, console) {
    let seed = 7;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const text = Array.from({ length: 400 }, (_, i) => `{"id":${i},"user":"user${random(5000)}","score":${random(1000)}}`).join('\n');
    const source = await allocBuffer(text.length);
    await writeBytes(source, text);
    const bound = await ZSTD_compressBound(text.length);
    const frame = await allocBuffer(bound);
    const check = async (code) => {
        if (await ZSTD_isError(code)) throw new Error(await ZSTD_getErrorName(code));
        return code;
    };
    const level = await ZSTD_cParameter.ZSTD_c_compressionLevel;
    const checksumFlag = await ZSTD_cParameter.ZSTD_c_checksumFlag;
    const windowLog = await ZSTD_cParameter.ZSTD_c_windowLog;
    const compress = async (value, checksum, window) => {
        const cctx = await ZSTD_createCCtx();
        try {
            await check(await ZSTD_CCtx_setParameter(cctx, level, value));
            await check(await ZSTD_CCtx_setParameter(cctx, checksumFlag, checksum ? 1 : 0));
            if (window) await check(await ZSTD_CCtx_setParameter(cctx, windowLog, window));
            return await check(await ZSTD_compress2(cctx, frame, bound, source, text.length));
        } finally {
            await ZSTD_freeCCtx(cctx);
        }
    };
    for (const value of [3, 9, 19]) console.log(`level ${value}: ${text.length} B -> ${await compress(value, false, 0)} B`);
    const size = await compress(19, true, 10);
    console.log(`level 19, 1 KiB window, checksum: ${size} B`);
    console.log(`content ${await ZSTD_getFrameContentSize(frame, size)} B`);
}

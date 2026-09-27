export const title = 'Compress and decompress a buffer';
export const summary = 'The two calls most zstd code makes: ZSTD_compress, and ZSTD_decompress with the original size read back from the frame.';
export const native = 'zstd_codec.h';
export const expected = ['1.5.7 27 28 b5 2f fd', 'true'];

export default async function example({ Zstd }, console) {
    const text = 'crossbind '.repeat(100);
    const frame = await Zstd.compress(text, 19);
    const bytes = Uint8Array.from(frame, (c) => c.charCodeAt(0));
    console.log(await Zstd.version(), bytes.length, [...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' '));
    console.log((await Zstd.decompress(frame)) === text);
}

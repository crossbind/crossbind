export const title = 'Compress and decompress a buffer';
export const summary = 'The two calls most zlib code makes: compress2 at a chosen level, and uncompress with the original size the caller kept.';
export const native = 'zlib_codec.h';
export const expected = ['1.3.2 27 78 da', 'true'];

export default async function example({ Zlib }, console) {
    const text = 'crossbind '.repeat(100);
    const packed = await Zlib.compress(text, 9);
    const bytes = Uint8Array.from(packed, (c) => c.charCodeAt(0));
    console.log(await Zlib.version(), bytes.length, [...bytes.slice(0, 2)].map((b) => b.toString(16)).join(' '));
    console.log((await Zlib.decompress(packed, text.length)) === text);
}

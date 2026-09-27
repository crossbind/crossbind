export const imports = {
    '@crossbind/port-zlib/zlib.h': ['crc32', 'adler32', 'crc32_combine', 'adler32_combine', 'allocBuffer', 'writeBytes'],
};
export const note = 'The same four zlib functions. The C++ took strings; the C functions take a `const Bytef *` and a length, so each piece is copied into its own `allocBuffer` first. The length that `crc32_combine` and `adler32_combine` take is a 64-bit `z_off_t`, and a plain Number works for it.';
export const expected = [
    'crc32 414fa339, adler32 5bdc0fda',
    'running crc32 414fa339, combined crc32 414fa339, combined adler32 5bdc0fda',
];

export default async function example({ crc32, adler32, crc32_combine, adler32_combine, allocBuffer, writeBytes }, console) {
    const hex = (value) => value.toString(16).padStart(8, '0');
    const buffer = async (text) => {
        const bytes = await allocBuffer(text.length);
        await writeBytes(bytes, text);
        return bytes;
    };
    const text = 'The quick brown fox jumps over the lazy dog';
    const all = await buffer(text);
    console.log(`crc32 ${hex(await crc32(0, all, text.length))}, adler32 ${hex(await adler32(1, all, text.length))}`);

    const [head, tail] = ['The quick brown fox ', 'jumps over the lazy dog'];
    const [first, second] = [await buffer(head), await buffer(tail)];
    const running = await crc32(await crc32(0, first, head.length), second, tail.length);
    const combined = await crc32_combine(await crc32(0, first, head.length), await crc32(0, second, tail.length), tail.length);
    const adler = await adler32_combine(await adler32(1, first, head.length), await adler32(1, second, tail.length), tail.length);
    console.log(`running crc32 ${hex(running)}, combined crc32 ${hex(combined)}, combined adler32 ${hex(adler)}`);
}

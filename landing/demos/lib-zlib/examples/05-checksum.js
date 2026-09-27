export const title = 'Checksum data in pieces';
export const summary = 'crc32 and adler32 continue a running value across pieces, and crc32_combine and adler32_combine join the checksums of pieces computed separately.';
export const native = 'zlib_checksum.h';
export const expected = [
    'crc32 414fa339, adler32 5bdc0fda',
    'running crc32 414fa339, combined crc32 414fa339, combined adler32 5bdc0fda',
];

export default async function example({ Checksum }, console) {
    const hex = (value) => value.toString(16).padStart(8, '0');
    const text = 'The quick brown fox jumps over the lazy dog';
    console.log(`crc32 ${hex(await Checksum.crc32(text))}, adler32 ${hex(await Checksum.adler32(text))}`);

    const [head, tail] = ['The quick brown fox ', 'jumps over the lazy dog'];
    const running = await Checksum.crc32Update(await Checksum.crc32(head), tail);
    const combined = await Checksum.crc32Combine(await Checksum.crc32(head), await Checksum.crc32(tail), tail.length);
    const adler = await Checksum.adler32Combine(await Checksum.adler32(head), await Checksum.adler32(tail), tail.length);
    console.log(`running crc32 ${hex(running)}, combined crc32 ${hex(combined)}, combined adler32 ${hex(adler)}`);
}

export const title = 'Write a .gz that remembers its file name';
export const summary = 'deflateInit2 with windowBits 15 + 16 writes gzip instead of zlib, and deflateSetHeader fills the header fields that gunzip -N restores. inflateGetHeader reads them back.';
export const native = 'gzip_header.h';
export const expected = ['3115 B -> 747 B, starts 1f 8b', 'readings.csv 2026-01-01T00:00:00.000Z', 'true'];

export default async function example({ Gzip }, console) {
    const rows = Array.from({ length: 200 }, (_, i) => `${i + 1},sensor-${i % 4},${18 + ((i * 7) % 9)}`);
    const csv = ['reading,sensor,celsius', ...rows].join('\n') + '\n';
    const gz = await Gzip.compress(csv, 'readings.csv', Date.UTC(2026, 0, 1) / 1000, 9);
    const bytes = Uint8Array.from(gz, (c) => c.charCodeAt(0));
    console.log(`${csv.length} B -> ${bytes.length} B, starts ${bytes[0].toString(16)} ${bytes[1].toString(16)}`);
    console.log(await Gzip.fileName(gz), new Date((await Gzip.modified(gz)) * 1000).toISOString());
    console.log((await Gzip.decompress(gz)) === csv);
}

export const title = 'Stream a file through gzip';
export const summary = 'For data you should not hold in one buffer: the deflate() and inflate() loops of zpipe.c, the example that ships with zlib, work file to file in 64 KB steps.';
export const native = 'gzip_stream.h';
export const expected = ['2537578 B -> 363636 B -> 2537578 B', 'true'];

export default async function example(m, console) {
    const { GzipStream } = m;
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const lines = Array.from({ length: 50000 }, (_, i) => `2026-09-24T12:00:${String(i % 60).padStart(2, '0')}Z GET /api/items/${random(9000)} ${random(10) ? 200 : 404} ${random(900)}ms`);
    // m.FS.writeFile adds to a file that already exists, so every run gets a fresh directory.
    const dir = await m.getRandomPath('/memfs');
    await m.FS.writeFile(`${dir}/access.log`, lines.join('\n'));

    const packed = await GzipStream.compressFile(`${dir}/access.log`, `${dir}/access.log.gz`, 6);
    const unpacked = await GzipStream.decompressFile(`${dir}/access.log.gz`, `${dir}/access.copy.log`);
    const original = await m.getFileBytes(`${dir}/access.log`);
    const copy = await m.getFileBytes(`${dir}/access.copy.log`);
    console.log(`${original.length} B -> ${packed} B -> ${unpacked} B`);
    console.log(copy.length === original.length && copy.every((byte, i) => byte === original[i]));
}

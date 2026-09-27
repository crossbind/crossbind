export const title = 'Stream a file through zstd';
export const summary = 'For data you should not hold in one buffer: ZSTD_compressStream2 and ZSTD_decompressStream work file to file in 128 KB steps.';
export const native = 'zstd_stream.h';
export const expected = ['2537578 B -> 378699 B -> 2537578 B', 'true'];

export default async function example(m, console) {
    const { ZstdStream } = m;
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const lines = Array.from({ length: 50000 }, (_, i) => `2026-09-24T12:00:${String(i % 60).padStart(2, '0')}Z GET /api/items/${random(9000)} ${random(10) ? 200 : 404} ${random(900)}ms`);
    // m.FS.writeFile adds to a file that already exists, so every run gets a fresh directory.
    const dir = await m.getRandomPath('/memfs');
    await m.FS.writeFile(`${dir}/access.log`, lines.join('\n'));

    const packed = await ZstdStream.compressFile(`${dir}/access.log`, `${dir}/access.log.zst`, 3);
    const unpacked = await ZstdStream.decompressFile(`${dir}/access.log.zst`, `${dir}/access.copy.log`);
    const original = await m.getFileBytes(`${dir}/access.log`);
    const copy = await m.getFileBytes(`${dir}/access.copy.log`);
    console.log(`${original.length} B -> ${packed} B -> ${unpacked} B`);
    console.log(copy.length === original.length && copy.every((byte, i) => byte === original[i]));
}

export const imports = {
    '@crossbind/port-zlib/zlib.h': ['gzopen', 'gzread', 'gzwrite', 'gzerror', 'gzclose', 'allocBuffer'],
};
export const note = 'The `deflate()` and `inflate()` loops cannot run from JavaScript: they read and advance the `next_in`, `avail_in`, `next_out` and `avail_out` fields of `z_stream`, which crossbind does not bind, so `deflate` returns -2 (`Z_STREAM_ERROR`). zlib\'s gz file calls stream instead, in the same 64 KiB steps and with the same sizes.';
export const expected = ['2537578 B -> 363636 B -> 2537578 B', 'true'];

export default async function example(m, console) {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const lines = Array.from({ length: 50000 }, (_, i) => `2026-09-24T12:00:${String(i % 60).padStart(2, '0')}Z GET /api/items/${random(9000)} ${random(10) ? 200 : 404} ${random(900)}ms`);
    // m.FS.writeFile adds to a file that already exists, so every run gets a fresh directory.
    const dir = await m.getRandomPath('/memfs');
    await m.FS.writeFile(`${dir}/access.log`, lines.join('\n'));

    // gzread reads a file that is not gzip as it is, and mode 'wbT' writes without gzip,
    // so the same loop runs in both directions.
    const chunk = await m.allocBuffer(64 << 10);
    const pipe = async (from, to, mode) => {
        const input = await m.gzopen(from, 'rb');
        const output = await m.gzopen(to, mode);
        let total = 0;
        for (;;) {
            const read = await m.gzread(input, chunk, 64 << 10);
            // gzread returns what it got before an error; gzerror says whether there was one.
            const error = await m.gzerror(input, null);
            if (error) throw new Error(error);
            if (read === 0) break;
            await m.gzwrite(output, chunk, read);
            total += read;
        }
        await m.gzclose(input);
        await m.gzclose(output);
        return total;
    };
    await pipe(`${dir}/access.log`, `${dir}/access.log.gz`, 'wb6');
    const unpacked = await pipe(`${dir}/access.log.gz`, `${dir}/access.copy.log`, 'wbT');
    const packed = (await m.getFileBytes(`${dir}/access.log.gz`)).length;
    const original = await m.getFileBytes(`${dir}/access.log`);
    const copy = await m.getFileBytes(`${dir}/access.copy.log`);
    console.log(`${original.length} B -> ${packed} B -> ${unpacked} B`);
    console.log(copy.length === original.length && copy.every((byte, i) => byte === original[i]));
}

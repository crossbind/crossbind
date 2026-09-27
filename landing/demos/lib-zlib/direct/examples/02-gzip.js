export const imports = {
    '@crossbind/port-zlib/zlib.h': ['gzopen', 'gzwrite', 'gzread', 'gzerror', 'gzclose', 'allocBuffer', 'writeBytes', 'readBytes'],
};
export const note = 'zlib\'s gz file calls write and read the .gz in `/memfs`, but `gzopen` writes a header with no name and a time of 0, and `deflateSetHeader` and `inflateGetHeader`, which fill and read those fields, need `gz_header` and `z_stream` fields that crossbind does not bind. So JavaScript writes the name and the time into the header and reads them back from the bytes; the file is byte for byte the one the C++ writes.';
export const expected = ['3115 B -> 747 B, starts 1f 8b', 'readings.csv 2026-01-01T00:00:00.000Z', 'true'];

export default async function example(m, console) {
    const rows = Array.from({ length: 200 }, (_, i) => `${i + 1},sensor-${i % 4},${18 + ((i * 7) % 9)}`);
    const csv = ['reading,sensor,celsius', ...rows].join('\n') + '\n';
    const dir = await m.getRandomPath('/memfs');
    const source = await m.allocBuffer(csv.length);
    await m.writeBytes(source, csv);
    const writer = await m.gzopen(`${dir}/bare.gz`, 'wb9');
    await m.gzwrite(writer, source, csv.length);
    await m.gzclose(writer);

    // The 10-byte header: magic, method, flags (8: a name follows), the time in little-endian seconds,
    // then XFL and OS, kept as zlib wrote them. gzopen leaves the flags and the time at 0.
    const bare = await m.getFileBytes(`${dir}/bare.gz`);
    const name = 'readings.csv';
    const time = Date.UTC(2026, 0, 1) / 1000;
    const header = [0x1f, 0x8b, 8, 8, time & 255, (time >>> 8) & 255, (time >>> 16) & 255, time >>> 24, bare[8], bare[9]];
    const gz = Uint8Array.from([...header, ...Array.from(name, (c) => c.charCodeAt(0)), 0, ...bare.subarray(10)]);
    console.log(`${csv.length} B -> ${gz.length} B, starts ${gz[0].toString(16)} ${gz[1].toString(16)}`);
    const fileName = String.fromCharCode(...gz.subarray(10, gz.indexOf(0, 10)));
    const modified = new DataView(gz.buffer).getUint32(4, true);
    console.log(fileName, new Date(modified * 1000).toISOString());

    await m.FS.writeFile(`${dir}/${name}.gz`, gz);
    const reader = await m.gzopen(`${dir}/${name}.gz`, 'rb');
    const copy = await m.allocBuffer(csv.length + 1);
    const read = await m.gzread(reader, copy, csv.length + 1);
    const error = await m.gzerror(reader, null);
    await m.gzclose(reader);
    if (error) throw new Error(error);
    console.log((await m.readBytes(copy, read)) === csv);
}

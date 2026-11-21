// Stand-ins for what the snapshots use of R2 and of the archives crossbind app preview --cloud uploads, for the tests.

// The part of an R2 bucket the snapshots use, kept in a Map: put takes a stream of a known length, as R2's does (in Node,
// test/support/register.mjs's FixedLengthStream), and list pages by `limit` with a cursor.
export function memoryBucket(now = () => Date.now()) {
    const objects = new Map();
    const described = (key) => ({ key, size: objects.get(key).bytes.length, uploaded: objects.get(key).uploaded });
    return {
        objects,
        async put(key, value) {
            const bytes = new Uint8Array(await new Response(value).arrayBuffer());
            objects.set(key, { bytes, uploaded: new Date(now()) });
            return described(key);
        },
        async get(key) {
            return objects.has(key) ? { ...described(key), body: new Response(objects.get(key).bytes).body } : null;
        },
        async head(key) {
            return objects.has(key) ? described(key) : null;
        },
        async delete(keys) {
            [keys].flat().forEach((key) => objects.delete(key));
        },
        async list({ prefix = '', cursor, limit = 1000 } = {}) {
            const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
            const from = cursor === undefined ? 0 : Number(cursor);
            const truncated = from + limit < keys.length;
            return { objects: keys.slice(from, from + limit).map(described), truncated, ...(truncated ? { cursor: String(from + limit) } : {}) };
        },
    };
}

const BLOCK = 512;
const utf8 = new TextEncoder();

// A ustar header of a file, as the format writes it: a path past 100 characters is cut at its last slash into the
// header's prefix and name. `options` write what crossbind never sends: another type, a broken checksum, another magic.
export function ustarHeader(path, size, { type = '0', checksum, magic = 'ustar\0' } = {}) {
    const block = new Uint8Array(BLOCK);
    const write = (at, value) => block.set(utf8.encode(value), at);
    const cut = path.length > 100 ? path.lastIndexOf('/') : -1;
    write(0, path.slice(cut + 1));
    if (cut !== -1) write(345, path.slice(0, cut));
    write(100, '0000644\0');
    write(108, '0000000\0');
    write(116, '0000000\0');
    write(124, `${size.toString(8).padStart(11, '0')}\0`);
    write(136, '00000000000\0');
    write(148, '        ');
    write(156, type);
    write(257, magic);
    write(263, '00');
    const sum = block.reduce((total, byte) => total + byte, 0);
    write(148, `${(checksum ?? sum).toString(8).padStart(6, '0')}\0 `);
    return block;
}

// An archive of [path, contents, options?] entries, each padded to its blocks, and its end of two empty blocks unless
// `end` is false.
export function archiveOf(entries, { end = true } = {}) {
    const parts = entries.flatMap(([path, contents, options]) => {
        const bytes = typeof contents === 'string' ? utf8.encode(contents) : contents;
        return [ustarHeader(path, bytes.length, options), bytes, new Uint8Array((BLOCK - (bytes.length % BLOCK)) % BLOCK)];
    });
    if (end) parts.push(new Uint8Array(2 * BLOCK));
    const archive = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    parts.reduce((at, part) => {
        archive.set(part, at);
        return at + part.length;
    }, 0);
    return archive;
}

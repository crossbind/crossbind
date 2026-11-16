import fs from 'node:fs';
import zlib from 'node:zlib';

// The zip of a submission's files, which Partner Center takes in one: each entry stored as it is, as packages and PNGs
// are compressed already, and with no ZIP64, so the zip stays under 4 GB.
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const MOST = 0xffffffff;
const UTF8_NAMES = 0x0800;
// 1 January 1980, the first day a zip's DOS date names.
const DOS_DATE = 0x21;

function localHeader(name, crc, size) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name]);
}

function centralHeader({
    name, crc, size, offset,
}) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    return Buffer.concat([header, name]);
}

// Writes the zip of the files, each { name, file } under its name, into output.
export function writeZip(entries, output) {
    const descriptor = fs.openSync(output, 'w');
    try {
        const written = [];
        let offset = 0;
        for (const { name, file } of entries) {
            const bytes = fs.readFileSync(file);
            const nameBytes = Buffer.from(name, 'utf8');
            if (offset + 30 + nameBytes.length + bytes.length > MOST) throw new Error(`crossbind: ${file} takes the submission's zip past the 4 GB Partner Center's zip takes without ZIP64.`);
            const entry = {
                name: nameBytes, crc: zlib.crc32(bytes), size: bytes.length, offset,
            };
            const header = localHeader(nameBytes, entry.crc, entry.size);
            fs.writeSync(descriptor, header);
            fs.writeSync(descriptor, bytes);
            written.push(entry);
            offset += header.length + bytes.length;
        }
        const central = Buffer.concat(written.map(centralHeader));
        const end = Buffer.alloc(22);
        end.writeUInt32LE(END, 0);
        end.writeUInt16LE(written.length, 8);
        end.writeUInt16LE(written.length, 10);
        end.writeUInt32LE(central.length, 12);
        end.writeUInt32LE(offset, 16);
        fs.writeSync(descriptor, Buffer.concat([central, end]));
    } finally {
        fs.closeSync(descriptor);
    }
}

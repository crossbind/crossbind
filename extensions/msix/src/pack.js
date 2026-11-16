import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// An MSIX package as Microsoft's packaging SDK writes one (microsoft/msix-packaging, src/msix/pack): a ZIP64 archive
// with a data descriptor after each file, whose AppxBlockMap.xml holds the SHA-256 of every 64 KB block of every file.
// A compressed file deflates each block on its own, closed by a full flush, so the block map can give each block's
// compressed size; an empty final block ends its stream.
const BLOCK_SIZE = 65536;
const ZIP64_VERSION = 45;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const DEFLATE = 8;
const STORE = 0;
const MAX32 = 0xffffffff;
// 1 Jan 2026, 00:00, so a package of the same files is the same bytes.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const DEFLATE_OPTIONS = { level: 9, memLevel: 9 };

const MANIFEST = 'AppxManifest.xml';
const BLOCK_MAP = 'AppxBlockMap.xml';
const CONTENT_TYPES = '[Content_Types].xml';
const MANIFEST_TYPE = 'application/vnd.ms-appx.manifest+xml';
const BLOCK_MAP_TYPE = 'application/vnd.ms-appx.blockmap+xml';
const RESERVED_FILES = new Set([MANIFEST, BLOCK_MAP, CONTENT_TYPES, 'AppxSignature.p7x'].map((name) => name.toLowerCase()));
const RESERVED_FOLDER = 'appxmetadata/';

// The content types of the files an app carries, as the SDK names them; any other is a stream of bytes. The SDK stores
// what is compressed already, and deflates the rest.
const TYPES = {
    css: 'text/css',
    csv: 'text/csv',
    dll: 'application/x-msdownload',
    exe: 'application/x-msdownload',
    gif: 'image/gif',
    htm: 'text/html',
    html: 'text/html',
    ico: 'image/vnd.microsoft.icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'application/x-javascript',
    json: 'application/json',
    png: 'image/png',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    xml: 'text/xml',
    zip: 'application/x-zip-compressed',
};
const STORED = new Set(['avi', 'cab', 'gif', 'gz', 'jpeg', 'jpg', 'm4a', 'mov', 'mp3', 'mpeg', 'mpg', 'png', 'rar', 'tar', 'wma', 'wmv', 'zip']);

const extensionOf = (name) => {
    const base = name.slice(name.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
};

// A part's name in the ZIP: the characters the SDK escapes as %XX, and the UTF-8 bytes of the rest above ASCII.
const ESCAPED = new Set([' ', '!', '#', '$', '%', '&', "'", '(', ')', '+', ',', ';', '=', '@', '[', ']', '^', '`', '{', '}']);
export function partName(name) {
    let encoded = '';
    for (const char of name) {
        if (char === '\\') encoded += '/';
        else if (ESCAPED.has(char) || char.codePointAt(0) > 0x7f) {
            encoded += [...Buffer.from(char, 'utf8')].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
        } else encoded += char;
    }
    return encoded;
}

export const xmlText = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

// The [Content_Types].xml of the parts: a Default for each extension's first type, an Override for a part with no
// extension or another type than its extension's.
function contentTypesXml(parts) {
    const defaults = new Map();
    const lines = [];
    for (const { name, type } of parts) {
        const extension = extensionOf(name);
        if (extension && !defaults.has(extension)) {
            defaults.set(extension, type);
            lines.push(`<Default Extension="${xmlText(extension)}" ContentType="${type}"/>`);
        } else if (!extension || defaults.get(extension) !== type) {
            lines.push(`<Override PartName="/${xmlText(partName(name))}" ContentType="${type}"/>`);
        }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${lines.join('')}</Types>`;
}

function blockMapXml(files) {
    const entries = files.map(({ name, size, lfhSize, blocks }) => {
        const children = blocks.map(
            ({ hash, size: compressed }) => `<Block Hash="${hash}"${compressed === undefined ? '' : ` Size="${compressed}"`}/>`,
        );
        return `<File Name="${xmlText(name.replaceAll('/', '\\'))}" Size="${size}" LfhSize="${lfhSize}">${children.join('')}</File>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<BlockMap xmlns="http://schemas.microsoft.com/appx/2010/blockmap" HashMethod="http://www.w3.org/2001/04/xmlenc#sha256">${entries.join('')}</BlockMap>`;
}

function localHeader(name, method) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(ZIP64_VERSION, 4);
    header.writeUInt16LE(DATA_DESCRIPTOR_FLAG, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name]);
}

function dataDescriptor(crc, compressed, uncompressed) {
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeBigUInt64LE(BigInt(compressed), 8);
    descriptor.writeBigUInt64LE(BigInt(uncompressed), 16);
    return descriptor;
}

function centralHeader({ name, method, crc, compressed, uncompressed, offset }) {
    const large = [uncompressed, compressed, offset].filter((value) => value >= MAX32);
    const extra = Buffer.alloc(large.length > 0 ? 4 + 8 * large.length : 0);
    if (large.length > 0) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8 * large.length, 2);
        large.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + 8 * index));
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(ZIP64_VERSION, 4);
    header.writeUInt16LE(ZIP64_VERSION, 6);
    header.writeUInt16LE(DATA_DESCRIPTOR_FLAG, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(Math.min(compressed, MAX32), 20);
    header.writeUInt32LE(Math.min(uncompressed, MAX32), 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(Math.min(offset, MAX32), 42);
    return Buffer.concat([header, name, extra]);
}

function endRecords(count, size, offset) {
    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50, 0);
    zip64.writeBigUInt64LE(44n, 4);
    zip64.writeUInt16LE(ZIP64_VERSION, 12);
    zip64.writeUInt16LE(ZIP64_VERSION, 14);
    zip64.writeBigUInt64LE(BigInt(count), 24);
    zip64.writeBigUInt64LE(BigInt(count), 32);
    zip64.writeBigUInt64LE(BigInt(size), 40);
    zip64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + size), 8);
    locator.writeUInt32LE(1, 16);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(MAX32, 12);
    end.writeUInt32LE(MAX32, 16);
    return Buffer.concat([zip64, locator, end]);
}

// Every file under a folder, by its path inside it with forward slashes, in a fixed order.
export function filesIn(root) {
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) found.push({ name: path.relative(root, file).split(path.sep).join('/'), file });
        }
    };
    walk(root);
    return found;
}

// Writes an MSIX package of the files ({ name, file } or { name, data }) and the manifest's text to output.
export function writeMsix({ files, manifest }, output) {
    const fd = fs.openSync(output, 'w');
    let offset = 0;
    const write = (buffer) => {
        fs.writeSync(fd, buffer);
        offset += buffer.length;
    };
    const central = [];
    const mapped = [];
    const typed = [];

    const add = (name, data, { type, inBlockMap, encodeName = true }) => {
        const isCompressed = !STORED.has(extensionOf(name));
        const method = isCompressed ? DEFLATE : STORE;
        const zipName = Buffer.from(encodeName ? partName(name) : name, 'utf8');
        const start = offset;
        write(localHeader(zipName, method));
        let crc = 0;
        let compressed = 0;
        const blocks = [];
        for (let at = 0; at < data.length; at += BLOCK_SIZE) {
            const block = data.subarray(at, Math.min(at + BLOCK_SIZE, data.length));
            crc = zlib.crc32(block, crc);
            const hash = crypto.createHash('sha256').update(block).digest('base64');
            const bytes = isCompressed ? zlib.deflateRawSync(block, { ...DEFLATE_OPTIONS, finishFlush: zlib.constants.Z_FULL_FLUSH }) : block;
            write(bytes);
            compressed += bytes.length;
            blocks.push(isCompressed ? { hash, size: bytes.length } : { hash });
        }
        if (isCompressed) {
            const end = zlib.deflateRawSync(Buffer.alloc(0), DEFLATE_OPTIONS);
            write(end);
            compressed += end.length;
        }
        write(dataDescriptor(crc, compressed, data.length));
        central.push(centralHeader({ name: zipName, method, crc, compressed, uncompressed: data.length, offset: start }));
        if (inBlockMap) mapped.push({ name, size: data.length, lfhSize: 30 + zipName.length, blocks });
        if (type) typed.push({ name, type });
    };

    try {
        for (const { name, file, data } of files) {
            const lower = name.toLowerCase();
            if (RESERVED_FILES.has(lower) || lower.startsWith(RESERVED_FOLDER)) {
                throw new Error(`crossbind: ${name} is a file an MSIX package makes itself, and no file of the app may take its name.`);
            }
            add(name, data ?? fs.readFileSync(file), { type: TYPES[extensionOf(name)] ?? 'application/octet-stream', inBlockMap: true });
        }
        add(MANIFEST, Buffer.from(manifest, 'utf8'), { type: MANIFEST_TYPE, inBlockMap: true });
        add(BLOCK_MAP, Buffer.from(blockMapXml(mapped), 'utf8'), { type: BLOCK_MAP_TYPE, inBlockMap: false });
        add(CONTENT_TYPES, Buffer.from(contentTypesXml(typed), 'utf8'), { inBlockMap: false, encodeName: false });
        const directoryOffset = offset;
        for (const header of central) write(header);
        write(endRecords(central.length, offset - directoryOffset, directoryOffset));
    } finally {
        fs.closeSync(fd);
    }
    return output;
}

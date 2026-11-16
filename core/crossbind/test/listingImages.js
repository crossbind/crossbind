import fs from 'node:fs';
import upath from 'upath';

// The images a store's listing tests take: a PNG's or a JPEG's header alone, which is all a listing's checks read.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// PNG's color types: RGB, and RGB with an alpha channel.
export const RGB = 2;
export const RGBA = 6;

function chunk(type, data = Buffer.alloc(0)) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

// A PNG of the size and color type, with a tRNS chunk before its image data where asked.
export function pngOf(width, height, { colorType = RGB, isTransparent = false } = {}) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([
        PNG_SIGNATURE, chunk('IHDR', header), ...(isTransparent ? [chunk('tRNS', Buffer.from([0, 0]))] : []), chunk('IDAT'), chunk('IEND'),
    ]);
}

// A JPEG of the size, with an APP0 segment before its frame, as a camera's has, and the frame's marker given.
export function jpegOf(width, height, marker = 0xc0) {
    const frame = Buffer.from([0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]), frame, Buffer.from([0xff, 0xd9])]);
}

// Writes a file under the folder, made with its folders, and gives its path.
export function writeUnder(folder, file, bytes = '') {
    const full = upath.join(folder, ...file.split('/'));
    fs.mkdirSync(upath.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
    return full;
}

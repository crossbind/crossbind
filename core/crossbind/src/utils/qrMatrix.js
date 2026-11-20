// A QR code of a short text, as a matrix of modules (ISO/IEC 18004): byte mode, error correction level M, versions 1 to
// 6. It imports nothing and uses no Node API, so a terminal and a web page draw the same matrix. Its matrices for every
// version and mask are the ones macOS's own QR reader reads back (test/qr/readBack.mjs).

// Per version, level M: [data codewords, error correction codewords per block, blocks]. Every block of a version is
// the same length up to version 6.
const LEVEL_M = [null, [16, 10, 1], [28, 16, 1], [44, 26, 1], [64, 18, 2], [86, 24, 2], [108, 16, 4]];
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
const LEVEL_M_BITS = 0b00;
const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// GF(256) over x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

// The generator polynomial of `degree` error correction codewords, its leading 1 left out.
function generatorOf(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < degree; j += 1) {
            result[j] = multiply(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = multiply(root, 0x02);
    }
    return result;
}

function correctionOf(data, generator) {
    const result = new Array(generator.length).fill(0);
    for (const byte of data) {
        const factor = byte ^ result.shift();
        result.push(0);
        generator.forEach((coefficient, i) => { result[i] ^= multiply(coefficient, factor); });
    }
    return result;
}

// Mode, count, bytes, terminator, then the pad codewords up to the version's data codewords.
function dataCodewords(bytes, capacity) {
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, 8);
    bytes.forEach((byte) => push(byte, 8));
    push(0, Math.min(4, capacity * 8 - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
    return codewords;
}

// The data split in its blocks, each block's correction computed, then both interleaved.
function interleaved(data, version) {
    const [, correction, blocks] = LEVEL_M[version];
    const length = data.length / blocks;
    const generator = generatorOf(correction);
    const dataBlocks = Array.from({ length: blocks }, (_, b) => data.slice(b * length, (b + 1) * length));
    const correctionBlocks = dataBlocks.map((block) => correctionOf(block, generator));
    const result = [];
    for (let i = 0; i < length; i += 1) dataBlocks.forEach((block) => result.push(block[i]));
    for (let i = 0; i < correction; i += 1) correctionBlocks.forEach((block) => result.push(block[i]));
    return result;
}

function formatBits(mask) {
    const data = (LEVEL_M_BITS << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    return ((data << 10) | remainder) ^ 0x5412;
}

// Its two copies around the finders, and the dark module.
function placeFormat(set, size, bits) {
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
}

// The penalty of a masked matrix (rules N1–N4), by which the mask is chosen.
function penalty(modules) {
    const size = modules.length;
    const lines = [...modules, ...modules.map((_, x) => modules.map((row) => row[x]))];
    let score = 0;
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i += 1) {
            if (i < size && line[i] === line[i - 1]) {
                run += 1;
            } else {
                if (run >= 5) score += run - 2;
                run = 1;
            }
        }
        const text = line.map((dark) => (dark ? '1' : '0')).join('');
        for (const pattern of ['10111010000', '00001011101']) {
            for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) score += 40;
        }
    }
    for (let y = 0; y + 1 < size; y += 1) {
        for (let x = 0; x + 1 < size; x += 1) {
            const dark = modules[y][x];
            if (dark === modules[y][x + 1] && dark === modules[y + 1][x] && dark === modules[y + 1][x + 1]) score += 3;
        }
    }
    const darkCount = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    return score + 10 * Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size));
}

// { version, mask, size, modules }: modules[y][x] is true for a dark module. The smallest version that holds the text
// and the mask of least penalty, unless `version` or `mask` is given.
export function qrMatrix(text, { version: asked, mask: askedMask } = {}) {
    const bytes = [...new TextEncoder().encode(text)];
    const fits = (v) => 12 + 8 * bytes.length <= LEVEL_M[v][0] * 8;
    const version = asked ?? [1, 2, 3, 4, 5, 6].find(fits);
    if (!version || !LEVEL_M[version] || !fits(version)) throw new Error(`a QR code of version 1 to 6 holds 106 bytes at most, and this text has ${bytes.length}`);
    const size = 17 + 4 * version;
    const base = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { base[y][x] = dark; fixed[y][x] = true; };

    for (let i = 0; i < size; i += 1) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
        for (let dy = -4; dy <= 4; dy += 1) {
            for (let dx = -4; dx <= 4; dx += 1) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                if (cx + dx >= 0 && cx + dx < size && cy + dy >= 0 && cy + dy < size) set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
            }
        }
    }
    const centers = ALIGNMENT[version];
    const last = centers[centers.length - 1];
    for (const cx of centers) {
        for (const cy of centers) {
            if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
            for (let dy = -2; dy <= 2; dy += 1) {
                for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }
    placeFormat(set, size, 0);

    const codewords = interleaved(dataCodewords(bytes, LEVEL_M[version][0]), version);
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vertical = 0; vertical < size; vertical += 1) {
            for (let j = 0; j < 2; j += 1) {
                const x = right - j;
                const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
                if (!fixed[y][x] && bit < codewords.length * 8) {
                    base[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
                    bit += 1;
                }
            }
        }
    }

    const masked = (mask) => {
        const modules = base.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== MASKS[mask](x, y))));
        placeFormat((x, y, dark) => { modules[y][x] = dark; }, size, formatBits(mask));
        return modules;
    };
    if (askedMask !== undefined) return { version, mask: askedMask, size, modules: masked(askedMask) };
    const candidates = MASKS.map((_, mask) => ({ mask, modules: masked(mask) }));
    const best = candidates.reduce((a, b) => (penalty(b.modules) < penalty(a.modules) ? b : a));
    return { version, mask: best.mask, size, modules: best.modules };
}

// The matrix as lines of half blocks, two rows a line, with a quiet zone around it.
export function halfBlocks(modules, { quiet = 2 } = {}) {
    const size = modules.length + quiet * 2;
    const dark = (x, y) => y >= quiet && y < size - quiet && x >= quiet && x < size - quiet && modules[y - quiet][x - quiet];
    const lines = [];
    for (let y = 0; y < size; y += 2) {
        let line = '';
        for (let x = 0; x < size; x += 1) {
            const top = dark(x, y);
            const bottom = y + 1 < size && dark(x, y + 1);
            if (top && bottom) line += '█';
            else if (top) line += '▀';
            else if (bottom) line += '▄';
            else line += ' ';
        }
        lines.push(line);
    }
    return lines;
}

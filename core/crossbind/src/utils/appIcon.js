// An app's icon: app.icon in crossbind.config.js, one square PNG the build makes each platform's icons from. Every size
// is resampled with a three-lobed Lanczos filter on premultiplied colors, as Tauri resizes icons.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { getContentHash } from './hash.js';

// A macOS .icns: each kind of entry and the size of the PNG it holds.
const ICNS_ENTRIES = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256],
    ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
// A Windows .ico's sizes, each a PNG.
const ICO_SIZES = [16, 24, 32, 48, 64, 256];
const LINUX_SIZE = 512;
// Xcode makes an iOS app's every size from this one.
const IOS_SIZE = 1024;
// An Android launcher icon's foreground at each density is 108 dp, of which the launcher's mask shows the middle 72.
const ANDROID_FOREGROUNDS = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const ANDROID_SHOWN = 72 / 108;
const WHITE = { red: 255, green: 255, blue: 255 };

// The app's icon, read and checked; none without app.icon.
export function readAppIcon(config) {
    const { icon } = config.app;
    if (icon === undefined) return null;
    if (typeof icon !== 'string' || !icon) {
        throw new Error(`crossbind: app.icon ${JSON.stringify(icon)} is no path to a PNG file, as 'icon.png' is.`);
    }
    const file = path.resolve(config.paths.project, icon);
    if (!fs.existsSync(file)) throw new Error(`crossbind: app.icon names ${file}, which does not exist.`);
    let bytes;
    let image;
    try {
        bytes = fs.readFileSync(file);
        image = PNG.sync.read(bytes);
    } catch (error) {
        throw new Error(`crossbind: app.icon ${file} is no PNG image: ${error.message}.`, { cause: error });
    }
    if (image.width !== image.height) {
        throw new Error(`crossbind: app.icon ${file} is ${image.width} × ${image.height} pixels; an app's icon is square, at best 1024 × 1024.`);
    }
    return { file, hash: getContentHash(bytes), image: { width: image.width, height: image.height, data: image.data } };
}

function lanczos3(x) {
    if (x === 0) return 1;
    if (x <= -3 || x >= 3) return 0;
    const px = Math.PI * x;
    return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

// For each pixel along one axis of the resized image, the first pixel of the original it takes and their weights.
function contributions(from, to) {
    const scale = from / to;
    // Shrinking widens the filter, so every pixel of the original counts.
    const stretch = Math.max(scale, 1);
    return Array.from({ length: to }, (_, index) => {
        const center = (index + 0.5) * scale;
        const first = Math.max(0, Math.ceil(center - 3 * stretch - 0.5));
        const last = Math.min(from - 1, Math.floor(center + 3 * stretch - 0.5));
        const weights = Array.from({ length: last - first + 1 }, (__, k) => lanczos3((first + k + 0.5 - center) / stretch));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        return { first, weights: weights.map((weight) => weight / total) };
    });
}

// One pass along x: each row of `width` pixels becomes `size` pixels, written to the output transposed, so the second
// pass along y is the same pass again.
function pass(source, width, height, size) {
    const out = new Float32Array(size * height * 4);
    contributions(width, size).forEach(({ first, weights }, x) => {
        for (let y = 0; y < height; y++) {
            const row = y * width;
            const at = (x * height + y) * 4;
            for (let k = 0; k < weights.length; k++) {
                const from = (row + first + k) * 4;
                out[at] += weights[k] * source[from];
                out[at + 1] += weights[k] * source[from + 1];
                out[at + 2] += weights[k] * source[from + 2];
                out[at + 3] += weights[k] * source[from + 3];
            }
        }
    });
    return out;
}

export function resize(image, size) {
    if (image.width === size) return image;
    const { width, height, data } = image;
    // Premultiplied, so the color of a transparent pixel does not bleed into its neighbors.
    const source = new Float32Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        source[i] = data[i] * alpha;
        source[i + 1] = data[i + 1] * alpha;
        source[i + 2] = data[i + 2] * alpha;
        source[i + 3] = data[i + 3];
    }
    const resized = pass(pass(source, width, height, size), height, size, size);
    const out = Buffer.alloc(size * size * 4);
    const clamp = (value) => Math.min(255, Math.max(0, Math.round(value)));
    for (let i = 0; i < out.length; i += 4) {
        // The filter overshoots now and then; the colors divide by what it gave, the alpha is clamped.
        const alpha = resized[i + 3];
        out[i + 3] = clamp(alpha);
        if (out[i + 3] === 0) continue;
        out[i] = clamp((resized[i] * 255) / alpha);
        out[i + 1] = clamp((resized[i + 1] * 255) / alpha);
        out[i + 2] = clamp((resized[i + 2] * 255) / alpha);
    }
    return { width: size, height: size, data: out };
}

// The image at `size` in the middle of a transparent square of `canvas`.
function centered(image, canvas, size) {
    const inner = resize(image, size);
    const out = Buffer.alloc(canvas * canvas * 4);
    const offset = Math.floor((canvas - size) / 2);
    for (let y = 0; y < size; y++) inner.data.copy(out, ((y + offset) * canvas + offset) * 4, y * size * 4, (y + 1) * size * 4);
    return { width: canvas, height: canvas, data: out };
}

const png = (image, options) => PNG.sync.write(image, options);

// A macOS app's icon file, which its Info.plist names.
export function macIcon(icon) {
    const pngs = new Map();
    const entries = ICNS_ENTRIES.map(([type, size]) => {
        if (!pngs.has(size)) pngs.set(size, png(resize(icon.image, size)));
        return chunk(type, pngs.get(size));
    });
    return chunk('icns', Buffer.concat(entries));
}

// An .icns chunk: its type, its length with these eight bytes, and what it holds.
function chunk(type, data) {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
}

// A Windows app's icon, which its executable carries.
export function windowsIcon(icon) {
    const images = ICO_SIZES.map((size) => png(resize(icon.image, size)));
    const header = Buffer.alloc(6 + 16 * images.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach((image, index) => {
        const at = 6 + 16 * index;
        // A width and height of 0 stand for 256.
        header.writeUInt8(ICO_SIZES[index] % 256, at);
        header.writeUInt8(ICO_SIZES[index] % 256, at + 1);
        header.writeUInt16LE(1, at + 4);
        header.writeUInt16LE(32, at + 6);
        header.writeUInt32LE(image.length, at + 8);
        header.writeUInt32LE(offset, at + 12);
        offset += image.length;
    });
    return Buffer.concat([header, ...images]);
}

// A Linux app's window icon.
export const linuxIcon = (icon) => png(resize(icon.image, LINUX_SIZE));

// A logo of a Windows app's MSIX package, square, at the size its manifest gives it.
export const windowsLogo = (icon, size) => png(resize(icon.image, size));

// The one image an iOS app's asset catalog holds, on white and without an alpha channel, which the App Store refuses
// even when every pixel is opaque.
export const iosIcon = (icon) => png(resize(icon.image, IOS_SIZE), { colorType: 2, bgColor: WHITE });

// An Android app's adaptive icon: its foreground at each density, with the whole icon in what the mask shows; its
// background is white.
export const androidIcons = (icon) => Object.fromEntries(Object.entries(ANDROID_FOREGROUNDS).map(([density, size]) => [
    `mipmap-${density}/ic_launcher_foreground.png`, png(centered(icon.image, size, Math.round(size * ANDROID_SHOWN))),
]));

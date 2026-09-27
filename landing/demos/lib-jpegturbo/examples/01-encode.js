export const title = 'Encode pixels to a JPEG';
export const summary = 'jpeg_mem_dest writes the file into memory; jpeg_set_quality and the luma sampling factors decide how much detail it keeps.';
export const native = 'jpeg_encoder.h';
export const expected = [
    'libjpeg-turbo 3.2.0: 100x75, 30000 B of RGBA',
    'quality 90, subsampling 444: 2791 B',
    'quality 90, subsampling 420: 1932 B',
    'quality 50, subsampling 420: 1171 B',
];

export default async function example({ JpegEncoder }, console) {
    const [width, height] = [100, 75];
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
        rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
    }
    const pixels = String.fromCharCode(...rgba);
    console.log(`libjpeg-turbo ${await JpegEncoder.version()}: ${width}x${height}, ${rgba.length} B of RGBA`);
    for (const [quality, subsampling] of [[90, 444], [90, 420], [50, 420]]) {
        const jpeg = await JpegEncoder.encode(pixels, width, height, quality, subsampling);
        console.log(`quality ${quality}, subsampling ${subsampling}: ${jpeg.length} B`);
    }
}

export const title = 'Decode straight to a thumbnail';
export const summary = 'Set scale_num and scale_denom before decoding and libjpeg-turbo runs a smaller inverse DCT on every block: a 1/8 decode never builds the full-size image.';
export const native = 'jpeg_thumbnail.h';
export const expected = ['1/1: 100x75', '1/2: 50x38', '1/4: 25x19', '1/8: 13x10', '520 B of RGBA instead of 30000 B'];

export default async function example({ JpegThumbnail, JpegEncoder }, console) {
    const [width, height] = [100, 75];
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
        rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
    }
    const jpeg = await JpegEncoder.encode(String.fromCharCode(...rgba), width, height, 90, 420); // the first example's encoder

    for (const denominator of [1, 2, 4, 8]) {
        console.log(`1/${denominator}: ${await JpegThumbnail.size(jpeg, denominator)}`);
    }
    const thumbnail = await JpegThumbnail.decode(jpeg, 8);
    console.log(`${thumbnail.length} B of RGBA instead of ${rgba.length} B`);
}

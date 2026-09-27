export const title = 'Make a JPEG smaller without re-encoding it';
export const summary = 'jpeg_read_coefficients and jpeg_write_coefficients copy the quantised DCT coefficients from one file to another, as `jpegtran -copy all` does: the Huffman coding is redone, optimised or progressive, and every pixel stays the same.';
export const native = 'jpeg_transcode.h';
export const expected = ['baseline 1932 B, optimized 1512 B, progressive 1773 B', 'true'];

export default async function example({ JpegTranscoder, JpegEncoder, JpegDecoder }, console) {
    const [width, height] = [100, 75];
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
        rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
    }
    const jpeg = await JpegEncoder.encode(String.fromCharCode(...rgba), width, height, 90, 420); // the first example's encoder

    const optimized = await JpegTranscoder.transcode(jpeg, true, false);
    const progressive = await JpegTranscoder.transcode(jpeg, false, true);
    console.log(`baseline ${jpeg.length} B, optimized ${optimized.length} B, progressive ${progressive.length} B`);
    const pixels = await JpegDecoder.decode(jpeg); // the second example's decoder
    console.log((await JpegDecoder.decode(optimized)) === pixels && (await JpegDecoder.decode(progressive)) === pixels);
}

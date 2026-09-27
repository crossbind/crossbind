export const title = 'Decode a JPEG and read its header';
export const summary = 'jpeg_mem_src reads the file from memory: jpeg_read_header answers what the image is before a pixel is decoded, and jpeg_read_scanlines decodes it to RGBA. A file libjpeg-turbo cannot read throws its message.';
export const native = 'jpeg_decoder.h';
export const expected = [
    '100x75, 3 components, YCbCr, baseline',
    '30000 B of RGBA; pixel (10, 10) was 20,30,160,255 and decodes as 22,29,159,255',
    'std::runtime_error: Not a JPEG file: starts with 0x63 0x72',
];

export default async function example({ JpegDecoder, JpegEncoder }, console) {
    const [width, height] = [100, 75];
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
        rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
    }
    const jpeg = await JpegEncoder.encode(String.fromCharCode(...rgba), width, height, 90, 420); // the first example's encoder

    const info = JSON.parse(await JpegDecoder.header(jpeg));
    console.log(`${info.width}x${info.height}, ${info.components} components, ${info.colorSpace}, ${info.progressive ? 'progressive' : 'baseline'}`);
    const decoded = Uint8Array.from(await JpegDecoder.decode(jpeg), (c) => c.charCodeAt(0));
    const at = (10 * width + 10) * 4;
    console.log(`${decoded.length} B of RGBA; pixel (10, 10) was ${rgba.slice(at, at + 4)} and decodes as ${decoded.slice(at, at + 4)}`);
    try {
        await JpegDecoder.decode('crossbind');
    } catch (error) {
        console.log(error.message);
    }
}

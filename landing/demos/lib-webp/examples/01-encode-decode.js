export const title = 'Encode pixels to WebP and decode them back';
export const summary = 'The simple API most code starts with: WebPEncodeRGBA at a quality, WebPEncodeLosslessRGBA, WebPGetInfo for the size in the header and WebPDecodeRGBA for the pixels. The input is a generated 256×256 landscape with a little noise, standing in for a photo.';
export const native = 'webp_codec.h';
export const expected = ['1.6.0 256x256', 'RGBA 262144 B -> lossy q80 1966 B, lossless 87058 B', 'true'];

export default async function example({ WebpCodec }, console) {
    let seed = 1;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    let rgba = '';
    for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
            const sun = (x - 180) ** 2 + (y - 70) ** 2 < 900;
            const hill = y > 170 + (((x - 128) ** 2) >> 8);
            const [r, g, b] = sun ? [255, 214, 90] : hill ? [40 + (y >> 2), 120 + (x >> 3), 50] : [90 + (y >> 1), 150 + (y >> 2), 235];
            rgba += String.fromCharCode(r ^ random(8), g ^ random(8), b ^ random(8), 255);
        }
    }

    const lossy = await WebpCodec.encode(rgba, 256, 256, 80);
    const lossless = await WebpCodec.encodeLossless(rgba, 256, 256);
    console.log(await WebpCodec.version(), await WebpCodec.dimensions(lossy));
    console.log(`RGBA ${rgba.length} B -> lossy q80 ${lossy.length} B, lossless ${lossless.length} B`);
    console.log((await WebpCodec.decode(lossless)) === rgba);
}

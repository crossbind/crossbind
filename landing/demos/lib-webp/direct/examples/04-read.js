export const imports = {
    '@crossbind/port-webp/webp/encode.h': ['WebPEncodeRGBA', 'WebPEncodeLosslessRGBA', 'allocBuffer', 'allocPointer', 'readPointerAt', 'writeBytes'],
    '@crossbind/port-webp/webp/decode.h': ['WebPGetFeatures', 'WebPBitstreamFeatures', 'VP8StatusCode'],
    '@crossbind/port-webp/webp/types.h': ['WebPFree'],
};
export const note = '`WebPGetFeatures` fills a `WebPBitstreamFeatures`, and its fields read back from JavaScript (`format` is 1 for lossy, 2 for lossless, 0 for mixed). The thumbnail and the region are missing: `WebPDecode` scales and crops by `config.options`, and crossbind binds `WebPDecoderConfig` without fields (`options` reads back undefined, and an `allocBuffer` block in its place is refused). The `WebPDecoderOptions` class it does bind has `use_scaling` but no `scaled_width` or `crop_left`, because libwebp declares those two to a line (`int crop_left, crop_top;`).';
export const expected = ['256x256 lossy, alpha: false, animated: false', '256x256 lossless, alpha: false, animated: false'];

export default async function example({ WebPEncodeRGBA, WebPEncodeLosslessRGBA, allocBuffer, allocPointer, readPointerAt, writeBytes, WebPGetFeatures, WebPBitstreamFeatures, VP8StatusCode, WebPFree }, console) {
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
    const pixels = await allocBuffer(rgba.length);
    await writeBytes(pixels, rgba);
    const output = await allocPointer(1);
    const lossySize = await WebPEncodeRGBA(pixels, 256, 256, 256 * 4, 80, output);
    const lossy = await readPointerAt(output, 0);
    const losslessSize = await WebPEncodeLosslessRGBA(pixels, 256, 256, 256 * 4, output);
    const lossless = await readPointerAt(output, 0);

    const formats = ['mixed', 'lossy', 'lossless'];
    for (const [webp, size] of [[lossy, lossySize], [lossless, losslessSize]]) {
        const features = await new WebPBitstreamFeatures();
        if ((await WebPGetFeatures(webp, size, features)) !== (await VP8StatusCode.VP8_STATUS_OK)) throw new Error('not a WebP image');
        console.log(`${await features.width}x${await features.height} ${formats[await features.format]}, alpha: ${Boolean(await features.has_alpha)}, animated: ${Boolean(await features.has_animation)}`);
    }
    await Promise.all([WebPFree(lossy), WebPFree(lossless)]);
}

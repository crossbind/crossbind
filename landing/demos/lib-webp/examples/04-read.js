export const title = 'Inspect a WebP, then decode only what you need';
export const summary = 'WebPGetFeatures reads size, alpha, animation and lossy or lossless from the header. WebPDecode with a WebPDecoderConfig scales to a thumbnail or crops a region while it decodes. The file comes from the first example\'s encoder.';
export const native = 'webp_reader.h';
export const expected = [
    '256x256 lossy, alpha: false, animated: false',
    '256x256 lossless, alpha: false, animated: false',
    'thumbnail 64x64: 16384 B, the sun at (45, 17) is rgba(251, 211, 93, 255)',
    'region 60x60 from (150, 40): 14400 B, its centre is rgba(251, 211, 93, 255)',
];

export default async function example({ WebpReader, WebpCodec }, console) {
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

    for (const webp of [lossy, lossless]) {
        const info = JSON.parse(await WebpReader.features(webp));
        console.log(`${info.width}x${info.height} ${info.format}, alpha: ${info.hasAlpha}, animated: ${info.hasAnimation}`);
    }
    const pixel = (pixels, width, x, y) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)].map((c) => c.charCodeAt(0)).join(', ');
    const thumbnail = await WebpReader.decodeScaled(lossy, 64, 64);
    console.log(`thumbnail 64x64: ${thumbnail.length} B, the sun at (45, 17) is rgba(${pixel(thumbnail, 64, 45, 17)})`);
    const region = await WebpReader.decodeRegion(lossy, 150, 40, 60, 60);
    console.log(`region 60x60 from (150, 40): ${region.length} B, its centre is rgba(${pixel(region, 60, 30, 30)})`);
}

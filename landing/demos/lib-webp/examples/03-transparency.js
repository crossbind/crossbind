export const title = 'Keep transparency, and decide what happens under it';
export const summary = 'A lossy WebP stores alpha in a plane of its own: `alpha_quality` 100 keeps it exact, lower values trade it for bytes. Lossless keeps every visible pixel, but may change the colour under fully transparent pixels to compress better unless `exact` is set.';
export const native = 'webp_alpha.h';
export const expected = [
    'lossy q80, alpha quality 100: 1890 B, alpha unchanged: true',
    'lossy q80, alpha quality 50: 1472 B, alpha unchanged: false',
    'lossless: 1710 B, identical: false',
    'lossless, exact: 1982 B, identical: true',
];

export default async function example({ WebpAlpha }, console) {
    let rgba = '';
    for (let y = 0; y < 128; y += 1) {
        for (let x = 0; x < 128; x += 1) {
            const d = (x - 64) ** 2 + (y - 64) ** 2;
            const alpha = d < 1600 ? 255 : d < 2304 ? Math.floor(((2304 - d) * 255) / 704) : 0;
            rgba += alpha ? String.fromCharCode(255 - x, 2 * y, 40, alpha) : String.fromCharCode(2 * x, 2 * y, 77, 0);
        }
    }
    const alphaOf = (pixels) => Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]).join('');

    for (const alphaQuality of [100, 50]) {
        const webp = await WebpAlpha.encodeLossy(rgba, 128, 128, 80, alphaQuality);
        const alphaKept = alphaOf(await WebpAlpha.decode(webp)) === alphaOf(rgba);
        console.log(`lossy q80, alpha quality ${alphaQuality}: ${webp.length} B, alpha unchanged: ${alphaKept}`);
    }
    for (const exact of [false, true]) {
        const webp = await WebpAlpha.encodeLossless(rgba, 128, 128, exact);
        console.log(`lossless${exact ? ', exact' : ''}: ${webp.length} B, identical: ${(await WebpAlpha.decode(webp)) === rgba}`);
    }
}

export const title = 'Tune the encoder and measure what it gave away';
export const summary = 'The advanced API: WebPConfigPreset picks settings for the kind of image, then method, sharp YUV and a target size adjust them before WebPEncode. WebPPlaneDistortion measures PSNR and SSIM against the original, so a quality can be chosen by numbers.';
export const native = 'webp_encoder.h';
export const expected = [
    'photo q50: 1300 B, PSNR 33.64 dB, SSIM 0.8993',
    'photo q75: 1658 B, PSNR 34.26 dB, SSIM 0.9047',
    'photo q90: 4388 B, PSNR 35.02 dB, SSIM 0.9133',
    'photo q75, method 6, sharp YUV: 1708 B, PSNR 34.58 dB, SSIM 0.9050',
    'photo, 3000 B target: 3000 B, PSNR 34.83 dB, SSIM 0.9097',
];

export default async function example({ WebpEncoder }, console) {
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

    for (const quality of [50, 75, 90]) {
        const encoder = await new WebpEncoder('photo', quality);
        const webp = await encoder.encode(rgba, 256, 256);
        console.log(`photo q${quality}: ${webp.length} B, ${await WebpEncoder.compare(rgba, webp)}`);
    }

    const slow = await new WebpEncoder('photo', 75);
    await slow.setMethod(6);
    await slow.setSharpYuv(true);
    const tuned = await slow.encode(rgba, 256, 256);
    console.log(`photo q75, method 6, sharp YUV: ${tuned.length} B, ${await WebpEncoder.compare(rgba, tuned)}`);

    const budget = await new WebpEncoder('photo', 75);
    await budget.setTargetSize(3000);
    const fitted = await budget.encode(rgba, 256, 256);
    console.log(`photo, 3000 B target: ${fitted.length} B, ${await WebpEncoder.compare(rgba, fitted)}`);
}

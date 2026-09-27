export const title = 'Keep 32-bit float samples exact';
export const summary = 'Elevation, temperature and microscopy data are not 8-bit pictures. SAMPLEFORMAT_IEEEFP stores the real values, the floating-point predictor helps them compress and TIFFReadScanline reads them back; TIFFRGBAImageOK says why the RGBA reader cannot.';
export const native = 'tiff_samples.h';
export const expected = ['262144 B of float32 -> Deflate 123852 B, with predictor 3 9072 B', 'true', 'Sorry, can not handle images with 32-bit samples'];

export default async function example({ TiffSamples }, console) {
    const width = 256;
    const height = 256;
    // An elevation grid in metres: a smooth saddle in steps of 1/64 m, so float32 holds every value exactly.
    const heights = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) heights[y * width + x] = 500 + ((x - 128) * (y - 96)) / 64;
    }
    let samples = ''; // the Float32Array's bytes, one character each
    for (const byte of new Uint8Array(heights.buffer)) samples += String.fromCharCode(byte);

    const plain = await TiffSamples.writeFloat32(samples, width, height, 8, 1); // 8 = Deflate, no predictor
    const predicted = await TiffSamples.writeFloat32(samples, width, height, 8, 3); // floating-point predictor
    console.log(`${samples.length} B of float32 -> Deflate ${plain.length} B, with predictor 3 ${predicted.length} B`);
    console.log((await TiffSamples.readFloat32(predicted)) === samples);
    console.log(await TiffSamples.rgbaCheck(predicted));
}

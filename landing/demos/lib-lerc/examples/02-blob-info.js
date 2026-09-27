export const title = "Read a blob's header without decoding it";
export const summary = '`lerc_getBlobInfo` answers from the header alone: size, data type, bands, valid pixels, the value range and the largest error the encoder allowed. A tile viewer uses it to size its buffers, or to skip an empty tile, before decoding. The blob comes from the codec in the first example, which asks for one float32 step less than 10 cm.';
export const native = 'lerc_blob_info.h';
export const expected = ['Lerc2 v6: 256x256, 1 band of float32, 65536 valid pixels, 67591 B', 'heights 1032.268 to 1500.945 m, stored within 0.099878 m'];

export default async function example({ LercCodec, LercBlobInfo }, console) {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const heights = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - 128;
            const dy = y - 128;
            heights[y * width + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000;
        }
    }
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const blob = await LercCodec.encode(toText(new Uint8Array(heights.buffer)), width, height, 0.1);

    const info = JSON.parse(await LercBlobInfo.read(blob));
    console.log(`${info.codec}: ${info.width}x${info.height}, ${info.bands} band of ${info.type}, ${info.validPixels} valid pixels, ${info.blobSize} B`);
    console.log(`heights ${info.zMin.toFixed(3)} to ${info.zMax.toFixed(3)} m, stored within ${info.maxZErrorUsed.toFixed(6)} m`);
}

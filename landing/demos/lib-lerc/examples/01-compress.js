export const title = 'Compress heights to within 1 cm';
export const summary = "LERC's main job: `lerc_encode` stores a float raster so that no value moves by more than the error you allow, and `lerc_decode` reads it back. The example checks the bound on every one of the 65,536 heights.";
export const native = 'lerc_codec.h';
export const expected = ['LERC 4.2.0: 262144 B of float32 heights -> 94775 B', 'largest error 0.0099 m, within 1 cm: true'];

export default async function example({ LercCodec }, console) {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const heights = new Float32Array(width * height); // metres, row by row from the top left
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - 128;
            const dy = y - 128;
            heights[y * width + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000; // a hill, rough to 1 m
        }
    }
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

    const blob = await LercCodec.encode(toText(new Uint8Array(heights.buffer)), width, height, 0.01);
    const decoded = new Float32Array(toBytes(await LercCodec.decode(blob)).buffer);
    let worst = 0;
    for (let i = 0; i < heights.length; i += 1) worst = Math.max(worst, Math.abs(decoded[i] - heights[i]));
    console.log(`LERC ${await LercCodec.version()}: ${heights.byteLength} B of float32 heights -> ${blob.length} B`);
    console.log(`largest error ${worst.toFixed(4)} m, within 1 cm: ${worst <= 0.01}`);
}

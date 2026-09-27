export const title = 'Keep integer data exact';
export const summary = 'Class maps and sensor counts must not change at all. With a `maxZError` of 0, LERC stores integers exactly (it raises 0 to 0.5, which rounds back to the same whole number) and float32 bit for bit. Here, a 12-bit sensor band in 16-bit pixels.';
export const native = 'lerc_lossless.h';
export const expected = ['uint16, 256x256: 131072 B -> 59091 B', 'identical: true'];

export default async function example({ LercLossless }, console) {
    let seed = 7;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const width = 256;
    const height = 256;
    const band = new Uint16Array(width * height); // a gradient plus sensor noise, 12-bit values
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) band[y * width + x] = 1800 + ((x + y) >> 1) + random(64);
    }
    const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

    const blob = await LercLossless.encode(toText(new Uint8Array(band.buffer)), 'uint16', width, height, 1);
    const back = new Uint16Array(toBytes(await LercLossless.decode(blob)).buffer);
    console.log(`uint16, ${width}x${height}: ${band.byteLength} B -> ${blob.length} B`);
    console.log(`identical: ${back.length === band.length && back.every((value, i) => value === band[i])}`);
}

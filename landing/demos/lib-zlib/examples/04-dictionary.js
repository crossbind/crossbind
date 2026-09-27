export const title = 'Compress small messages with a preset dictionary';
export const summary = 'A short message has little to refer back to. Load earlier messages with deflateSetDictionary and inflateSetDictionary, and each new one compresses against them.';
export const native = 'zlib_dictionary.h';
export const expected = ['dictionary: 1195 B', '59 B message: 59 B alone, 11 B with the dictionary', 'true'];

export default async function example({ ZlibDictionary }, console) {
    const event = (i) => `{"event":"click","user":${1000 + ((i * 37) % 900)},"page":"/products/${i % 12}","ms":${(i * 7919) % 400}}`;
    const dictionary = Array.from({ length: 20 }, (_, i) => event(i)).join('\n');
    const plain = await new ZlibDictionary('', 9);
    const primed = await new ZlibDictionary(dictionary, 9);

    const message = event(4321);
    const alone = await plain.compress(message);
    const packed = await primed.compress(message);
    console.log(`dictionary: ${dictionary.length} B`);
    console.log(`${message.length} B message: ${alone.length} B alone, ${packed.length} B with the dictionary`);
    console.log((await primed.decompress(packed)) === message);
}

export const title = 'Compress small messages with a dictionary';
export const summary = 'Train once with ZDICT_trainFromBuffer, digest it once with ZSTD_createCDict and ZSTD_createDDict, then compress every message against it.';
export const native = 'zstd_dictionary.h';
export const expected = ['dictionary: 2048 B', '59 B message: 68 B alone, 29 B with the dictionary', 'true'];

export default async function example({ ZstdDictionary, Zstd }, console) {
    const event = (i) => `{"event":"click","user":${1000 + ((i * 37) % 900)},"page":"/products/${i % 12}","ms":${(i * 7919) % 400}}`;
    const samples = Array.from({ length: 4000 }, (_, i) => event(i)).join('\n');
    const dictionary = await ZstdDictionary.train(samples, 2048);
    const codec = await new ZstdDictionary(dictionary, 3);

    const message = event(4321);
    const alone = await Zstd.compress(message, 3); // the one-shot wrapper from the first example
    const frame = await codec.compress(message);
    console.log(`dictionary: ${dictionary.length} B`);
    console.log(`${message.length} B message: ${alone.length} B alone, ${frame.length} B with the dictionary`);
    console.log((await codec.decompress(frame)) === message);
}

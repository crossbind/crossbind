export const title = 'Transliterate or drop what the target cannot hold';
export const summary = 'Append `//TRANSLIT` to the target and iconv approximates a missing character; append `//IGNORE` and it drops it. The return value of `iconv` counts those characters. GNU libiconv transliterates the same way in every locale, so ASCII keeps accents as marks.';
export const native = 'legacy_encoder.h';
export const expected = [
    'ISO-8859-1//TRANSLIT: Crème brûlée - 5 EUR "spécial" (4 changed)',
    'ISO-8859-1//IGNORE: Crème brûlée  5  spécial (4 changed)',
    'ASCII//TRANSLIT: Cr`eme br^ul\'ee - 5 EUR "sp\'ecial" (8 changed)',
];

export default async function example({ LegacyEncoder, Charset }, console) {
    const text = 'Crème brûlée – 5 € “spécial”';
    for (const target of ['ISO-8859-1//TRANSLIT', 'ISO-8859-1//IGNORE', 'ASCII//TRANSLIT']) {
        const encoder = await new LegacyEncoder(target);
        const bytes = await encoder.encode(text);
        console.log(`${target}: ${await Charset.decode(bytes, 'ISO-8859-1')} (${await encoder.changed()} changed)`);
    }
}

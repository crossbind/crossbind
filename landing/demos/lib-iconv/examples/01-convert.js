export const title = 'Convert between UTF-8 and a legacy encoding';
export const summary = 'What most iconv code does: iconv_open, iconv in a loop and iconv_close, strict in both directions. A last call without input ends stateful encodings such as ISO-2022-JP, which is where the closing `ESC ( B` comes from.';
export const native = 'charset.h';
export const expected = ['93 fa 96 7b 8c ea', '日本語', '1b 24 42 46 7c 4b 5c 38 6c 1b 28 42', 'cannot encode U+20AC at character 7 in ISO-8859-1'];

export default async function example({ Charset }, console) {
    const hex = (bytes) => [...bytes].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const sjis = await Charset.encode('日本語', 'SHIFT_JIS');
    console.log(hex(sjis));
    console.log(await Charset.decode(sjis, 'SHIFT_JIS'));
    console.log(hex(await Charset.encode('日本語', 'ISO-2022-JP')));
    try {
        await Charset.encode('Total: €5', 'ISO-8859-1');
    } catch (error) {
        console.log(error.cppMessage ?? error.message);
    }
}

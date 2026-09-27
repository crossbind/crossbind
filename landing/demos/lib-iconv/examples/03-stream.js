export const title = 'Decode a stream that cuts characters in two';
export const summary = 'Bytes from fetch, a WebSocket or a serial port arrive in pieces of any size, so a multibyte character can straddle two pieces. `iconv` stops with `EINVAL` at such a cut and the unfinished bytes wait for the next piece; `E2BIG` only means the output buffer is full.';
export const native = 'stream_decoder.h';
export const expected = ['29 bytes in pieces of 3, 4 characters cut in two', '配送先: 東京都渋谷区神南1-2-3', 'SHIFT_JIS stream ends inside a character, 1 byte(s) left over'];

export default async function example({ StreamDecoder, Charset }, console) {
    const bytes = await Charset.encode('配送先: 東京都渋谷区神南1-2-3', 'SHIFT_JIS');
    const decoder = await new StreamDecoder('SHIFT_JIS');
    let text = '';
    for (let at = 0; at < bytes.length; at += 3) text += await decoder.write(bytes.slice(at, at + 3));
    await decoder.end();
    console.log(`${bytes.length} bytes in pieces of 3, ${await decoder.splits()} characters cut in two`);
    console.log(text);

    const cut = await new StreamDecoder('SHIFT_JIS');
    await cut.write(bytes.slice(0, 3));
    try {
        await cut.end();
    } catch (error) {
        console.log(error.cppMessage ?? error.message);
    }
}

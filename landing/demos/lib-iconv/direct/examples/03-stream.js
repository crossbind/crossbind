export const imports = {
    '@crossbind/port-iconv/iconv.h': [
        'libiconv_open',
        'libiconv',
        'libiconv_close',
        'allocBuffer',
        'allocPointer',
        'writeBytes',
        'readBytes',
        'writePointerAt',
        'writeNumberAt',
        'readNumberAt',
    ],
};
export const note = 'The stream works the same way: `libiconv` stops at a piece that ends inside a character, and the bytes it leaves wait for the next piece. What JavaScript cannot see is why it stopped, because `errno` is not bound: a cut (`EINVAL`) and an invalid byte (`EILSEQ`) both return `(size_t)-1` with bytes left, so an invalid byte would also wait and show up at the end as bytes left over, not as an error at its position.';
export const expected = ['29 bytes in pieces of 3, 4 characters cut in two', '配送先: 東京都渋谷区神南1-2-3', 'SHIFT_JIS stream ends inside a character, 1 byte(s) left over'];

export default async function example({ libiconv_open, libiconv, libiconv_close, allocBuffer, allocPointer, writeBytes, readBytes, writePointerAt, writeNumberAt, readNumberAt }, console) {
    // One iconv call over a byte string (one character per byte): the bytes it wrote and the input bytes it left.
    const run = async (cd, input) => {
        const source = await allocBuffer(input.length);
        await writeBytes(source, input);
        const room = input.length * 4 + 16;
        const output = await allocBuffer(room);
        const inbuf = await allocPointer(1);
        const outbuf = await allocPointer(1);
        await writePointerAt(inbuf, 0, source);
        await writePointerAt(outbuf, 0, output);
        const inbytesleft = await allocBuffer(4);
        const outbytesleft = await allocBuffer(4);
        await writeNumberAt(inbytesleft, 0, 'uint32', input.length);
        await writeNumberAt(outbytesleft, 0, 'uint32', room);
        await libiconv(cd, inbuf, inbytesleft, outbuf, outbytesleft);
        return {
            written: await readBytes(output, room - (await readNumberAt(outbytesleft, 0, 'uint32'))),
            left: await readNumberAt(inbytesleft, 0, 'uint32'),
        };
    };
    const encoder = await libiconv_open('SHIFT_JIS', 'UTF-8');
    const { written: bytes } = await run(encoder, String.fromCharCode(...new TextEncoder().encode('配送先: 東京都渋谷区神南1-2-3')));
    await libiconv_close(encoder);

    const decoder = await libiconv_open('UTF-8', 'SHIFT_JIS');
    let text = '';
    let pending = '';
    let cuts = 0;
    for (let at = 0; at < bytes.length; at += 3) {
        pending += bytes.slice(at, at + 3);
        const { written, left } = await run(decoder, pending);
        text += new TextDecoder().decode(Uint8Array.from(written, (c) => c.charCodeAt(0)));
        if (left) cuts += 1; // the piece ended inside a character: its bytes wait for the next one
        pending = pending.slice(pending.length - left);
    }
    console.log(`${bytes.length} bytes in pieces of 3, ${cuts} characters cut in two`);
    console.log(text);

    await libiconv(decoder, null, null, null, null); // a new stream starts from the initial state
    const { left } = await run(decoder, bytes.slice(0, 3));
    if (left) console.log(`SHIFT_JIS stream ends inside a character, ${left} byte(s) left over`);
    await libiconv_close(decoder);
}

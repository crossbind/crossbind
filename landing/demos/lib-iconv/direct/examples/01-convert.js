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
export const note = '`iconv.h` defines `iconv_open`, `iconv` and `iconv_close` as macros, so they are bound as `libiconv_open`, `libiconv` and `libiconv_close`, and JavaScript builds their `char **` and `size_t *` arguments itself: a pointer slot from `allocPointer` for each buffer, a 4-byte `allocBuffer` for each counter. `errno` is not bound, so a failed call cannot say whether the output was full (`E2BIG`) or the input stopped (`EILSEQ`, `EINVAL`): the output buffer is sized so it never fills. A failed `iconv_open` returns `(iconv_t)-1` as an ordinary handle; its address shows only when it is written to a pointer slot and read back as a number.';
export const expected = ['93 fa 96 7b 8c ea', '日本語', '1b 24 42 46 7c 4b 5c 38 6c 1b 28 42', 'cannot encode U+20AC at character 7 in ISO-8859-1'];

export default async function example({ libiconv_open, libiconv, libiconv_close, allocBuffer, allocPointer, writeBytes, readBytes, writePointerAt, writeNumberAt, readNumberAt }, console) {
    // Bytes travel as byte strings, one character (0-255) per byte.
    const utf8 = (text) => String.fromCharCode(...new TextEncoder().encode(text));
    const fromUtf8 = (bytes) => new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
    const hex = (bytes) => [...bytes].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const FAILED = 0xffffffff; // (size_t)-1 and (iconv_t)-1: both are 32-bit in wasm32

    const convert = async (input, from, to) => {
        const cd = await libiconv_open(to, from);
        // A failed iconv_open returns (iconv_t)-1, which shows only as the address in a pointer slot.
        const slot = await allocPointer(1);
        await writePointerAt(slot, 0, cd);
        if ((await readNumberAt(slot, 0, 'uint32')) === FAILED) throw new Error(`iconv cannot convert ${from} to ${to}`);
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
        const status = await libiconv(cd, inbuf, inbytesleft, outbuf, outbytesleft);
        // A call without input ends a stateful encoding: ISO-2022-JP switches back to ASCII.
        if (status !== FAILED) await libiconv(cd, null, null, outbuf, outbytesleft);
        await libiconv_close(cd);
        return {
            failed: status === FAILED,
            at: input.length - (await readNumberAt(inbytesleft, 0, 'uint32')),
            bytes: await readBytes(output, room - (await readNumberAt(outbytesleft, 0, 'uint32'))),
        };
    };

    const sjis = await convert(utf8('日本語'), 'UTF-8', 'SHIFT_JIS');
    console.log(hex(sjis.bytes));
    console.log(fromUtf8((await convert(sjis.bytes, 'SHIFT_JIS', 'UTF-8')).bytes));
    console.log(hex((await convert(utf8('日本語'), 'UTF-8', 'ISO-2022-JP')).bytes));

    // The input is valid UTF-8 from JavaScript, so a stop means the target has no such character.
    const text = 'Total: €5';
    const latin1 = await convert(utf8(text), 'UTF-8', 'ISO-8859-1');
    if (latin1.failed) {
        const character = [...fromUtf8(utf8(text).slice(0, latin1.at))].length;
        const code = [...text][character].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        console.log(`cannot encode U+${code} at character ${character} in ISO-8859-1`);
    }
}

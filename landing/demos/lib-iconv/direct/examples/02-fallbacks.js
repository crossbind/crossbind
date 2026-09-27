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
export const note = '`//TRANSLIT` and `//IGNORE` work unchanged, and the return value of `libiconv` (the bound name of `iconv`) still counts the characters approximated or dropped. `readBytes` hands the result back one character per byte, which is already how ISO-8859-1 and ASCII read, so it prints without a decode step. The output buffer is sized up front instead of grown on `E2BIG`, because `errno` is not bound.';
export const expected = [
    'ISO-8859-1//TRANSLIT: Crème brûlée - 5 EUR "spécial" (4 changed)',
    'ISO-8859-1//IGNORE: Crème brûlée  5  spécial (4 changed)',
    'ASCII//TRANSLIT: Cr`eme br^ul\'ee - 5 EUR "sp\'ecial" (8 changed)',
];

export default async function example({ libiconv_open, libiconv, libiconv_close, allocBuffer, allocPointer, writeBytes, readBytes, writePointerAt, writeNumberAt, readNumberAt }, console) {
    const text = 'Crème brûlée – 5 € “spécial”';
    const input = String.fromCharCode(...new TextEncoder().encode(text)); // its UTF-8 bytes, one character per byte
    for (const target of ['ISO-8859-1//TRANSLIT', 'ISO-8859-1//IGNORE', 'ASCII//TRANSLIT']) {
        const cd = await libiconv_open(target, 'UTF-8');
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
        const changed = await libiconv(cd, inbuf, inbytesleft, outbuf, outbytesleft);
        if (changed === 0xffffffff) throw new Error(`${target} stopped at byte ${input.length - (await readNumberAt(inbytesleft, 0, 'uint32'))}`);
        await libiconv(cd, null, null, outbuf, outbytesleft);
        const bytes = await readBytes(output, room - (await readNumberAt(outbytesleft, 0, 'uint32')));
        await libiconv_close(cd);
        console.log(`${target}: ${bytes} (${changed} changed)`);
    }
}

export const imports = {
    '@crossbind/port-iconv/iconv.h': ['_libiconv_version', 'iconvlist', 'iconv_open_into', 'iconv_allocation_t', 'iconv_canonicalize', 'readNumberAt', 'readPointerAt', 'readCString', 'releaseCallback'],
};
export const note = '`_libiconv_version` is a variable, so it arrives as a handle to its `int`, read with `readNumberAt`. `iconvlist`, a macro for `libiconvlist`, binds as that function. A JavaScript function can stand in for a C callback only on the page\'s thread, so this example runs with `useWorker: false`; the callback runs inside the call and reads the names without `await`. A failed `iconv_open` returns `(iconv_t)-1` as an ordinary handle, so the check uses `iconv_open_into`, which returns 0 or -1 and needs no close.';
export const expected = ({ iconv }) => [`libiconv ${iconv.split('.').slice(0, 2).join('.')}: 198 encodings under 736 names`, 'latin1: ISO-8859-1', 'SJIS: SHIFT_JIS', 'windows-1254: CP1254', 'UTF8: not supported', 'CP437: CP437'];
export const init = { useWorker: false };

export default async function example({ _libiconv_version, iconvlist, iconv_open_into, iconv_allocation_t, iconv_canonicalize, readNumberAt, readPointerAt, readCString, releaseCallback }, console) {
    const version = await readNumberAt(_libiconv_version, 0, 'int32'); // (major << 8) + minor
    const encodings = [];
    const addEncoding = (count, names) => {
        encodings.push(Array.from({ length: count }, (_, i) => readCString(readPointerAt(names, i))));
        return 0; // non-zero would stop the walk
    };
    await iconvlist(addEncoding, null);
    await releaseCallback(addEncoding);
    console.log(`libiconv ${version >> 8}.${version & 0xff}: ${encodings.length} encodings under ${encodings.flat().length} names`);

    // iconv_open_into fills this memory instead of allocating, so nothing needs iconv_close.
    const descriptor = await new iconv_allocation_t();
    for (const name of ['latin1', 'SJIS', 'windows-1254', 'UTF8', 'CP437']) {
        const works = (await iconv_open_into('UTF-8', name, descriptor)) === 0;
        console.log(`${name}: ${works ? await iconv_canonicalize(name) : 'not supported'}`);
    }
}

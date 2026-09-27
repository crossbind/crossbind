export const imports = {
    '@crossbind/port-iconv/iconv.h': ['libiconvlist', 'libiconv_open_into', 'iconv_allocation_t', 'iconv_canonicalize', 'readPointerAt', 'readCString', 'releaseCallback'],
};
export const note = '`iconvlist` (bound as `libiconvlist`) reports each encoding to a callback, and a JavaScript function can stand in for a C callback only on the page\'s thread, so this example runs with `useWorker: false`; the callback runs inside the call and reads the names without `await`. A failed `iconv_open` returns `(iconv_t)-1` as an ordinary handle, so the check uses `libiconv_open_into`, which returns 0 or -1 and needs no close. `_libiconv_version` is a variable, not a function, and is not bound, so the first line has no version.';
export const expected = ['libiconv: 112 encodings under 349 names', 'latin1: ISO-8859-1', 'SJIS: SHIFT_JIS', 'windows-1254: CP1254', 'UTF8: not supported', 'CP437: not supported'];
export const init = { useWorker: false };

export default async function example({ libiconvlist, libiconv_open_into, iconv_allocation_t, iconv_canonicalize, readPointerAt, readCString, releaseCallback }, console) {
    const encodings = [];
    const addEncoding = (count, names) => {
        encodings.push(Array.from({ length: count }, (_, i) => readCString(readPointerAt(names, i))));
        return 0; // non-zero would stop the walk
    };
    await libiconvlist(addEncoding, null);
    await releaseCallback(addEncoding);
    console.log(`libiconv: ${encodings.length} encodings under ${encodings.flat().length} names`);

    // iconv_open_into fills this memory instead of allocating, so nothing needs iconv_close.
    const descriptor = await new iconv_allocation_t();
    for (const name of ['latin1', 'SJIS', 'windows-1254', 'UTF8', 'CP437']) {
        const works = (await libiconv_open_into('UTF-8', name, descriptor)) === 0;
        console.log(`${name}: ${works ? await iconv_canonicalize(name) : 'not supported'}`);
    }
}

export const title = 'List the encodings and check a name';
export const summary = '`iconvlist` walks every encoding with its aliases and `iconv_canonicalize` names the canonical one, but only `iconv_open` proves a name works. GNU libiconv writes UTF-8 with its hyphen, and this build includes CP437 with the other DOS and EBCDIC code pages.';
export const native = 'encodings.h';
export const expected = ({ iconv }) => [`libiconv ${iconv.split('.').slice(0, 2).join('.')}: 198 encodings under 736 names`, 'latin1: ISO-8859-1', 'SJIS: SHIFT_JIS', 'windows-1254: CP1254', 'UTF8: not supported', 'CP437: CP437'];

export default async function example({ Encodings }, console) {
    const encodings = JSON.parse(await Encodings.list());
    console.log(`libiconv ${await Encodings.version()}: ${encodings.length} encodings under ${encodings.flat().length} names`);
    for (const name of ['latin1', 'SJIS', 'windows-1254', 'UTF8', 'CP437']) {
        console.log(`${name}: ${(await Encodings.resolve(name)) || 'not supported'}`);
    }
}

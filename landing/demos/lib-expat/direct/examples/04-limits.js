export const imports = {
    '@crossbind/port-expat/expat.h': [
        'XML_ParserCreate',
        'XML_SetCharacterDataHandler',
        'XML_Parse',
        'XML_Status',
        'XML_GetErrorCode',
        'XML_ErrorString',
        'XML_GetCurrentLineNumber',
        'XML_GetCurrentColumnNumber',
        'XML_ParserFree',
        'readCString',
        'releaseCallback',
    ],
};
export const note = '`XML_SetBillionLaughsAttackProtectionMaximumAmplification` and `...ActivationThreshold` are declared in `expat.h` only if `XML_DTD` is defined or `XML_GE` is 1, which the library\'s build sets in `expat_config.h`, a header the binding never reads, so importing either fails with `MISSING_EXPORT` although the library contains both. The protection still runs with the defaults the C++ passes (100 times, from 8 MiB), so the first three lines match and the 64 KiB threshold of the fourth cannot be set. Each piece of character data is a call into JavaScript that cuts its string down to `length` bytes, 867,703 of them before Expat stops the 9-level document, so this version runs nearly 20 times longer than the C++ one.';
export const expected = [
    'crossbind parses crossbind',
    '5 levels: 300000 characters',
    '9 levels: limit on input amplification factor (from DTD and entities) breached at line 14, column 6',
];
export const init = { useWorker: false };

export default async function example({ XML_ParserCreate, XML_SetCharacterDataHandler, XML_Parse, XML_Status, XML_GetErrorCode, XML_ErrorString, XML_GetCurrentLineNumber, XML_GetCurrentColumnNumber, XML_ParserFree, readCString, releaseCallback }, console) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // The document's character data, entities expanded under Expat's default limits.
    const text = (xml) => {
        let result = '';
        // `chunk` runs on to the next NUL byte in memory: only its first `length` bytes are this call's.
        const onText = (data, chunk, length) => {
            result += decoder.decode(encoder.encode(chunk).subarray(0, length));
        };
        const parser = XML_ParserCreate(null);
        try {
            XML_SetCharacterDataHandler(parser, onText);
            if (XML_Parse(parser, xml, encoder.encode(xml).length, 1) !== XML_Status.XML_STATUS_OK) {
                throw new Error(`${readCString(XML_ErrorString(XML_GetErrorCode(parser)))} at line ${XML_GetCurrentLineNumber(parser)}, column ${XML_GetCurrentColumnNumber(parser)}`);
            }
            return result;
        } finally {
            XML_ParserFree(parser);
            releaseCallback(onText);
        }
    };
    console.log(text('<!DOCTYPE note [<!ENTITY product "crossbind">]><note>&product; parses &product;</note>'));

    // Each level repeats the one below ten times: 9 levels would expand to 3 GB.
    const laughs = (levels) => {
        const entities = ['<!ENTITY lol0 "lol">'];
        for (let level = 1; level <= levels; level += 1) entities.push(`<!ENTITY lol${level} "${`&lol${level - 1};`.repeat(10)}">`);
        return `<?xml version="1.0"?>\n<!DOCTYPE lolz [\n${entities.join('\n')}\n]>\n<lolz>&lol${levels};</lolz>`;
    };
    console.log('5 levels:', text(laughs(5)).length, 'characters');
    try {
        text(laughs(9));
    } catch (error) {
        console.log('9 levels:', error.message);
    }
}

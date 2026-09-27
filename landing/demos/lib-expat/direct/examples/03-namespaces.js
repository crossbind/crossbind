export const imports = {
    '@crossbind/port-expat/expat.h': [
        'XML_ParserCreateNS',
        'XML_SetElementHandler',
        'XML_SetCharacterDataHandler',
        'XML_SetStartNamespaceDeclHandler',
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
export const note = 'The namespace separator is a C `char`, so it crosses as a number, `\'|\'.charCodeAt(0)`: the string `\'|\'` is accepted without an error but arrives as 0, and Expat then joins URI and local name with nothing between them. The handlers run on the page\'s thread as in the tree example, the default namespace\'s prefix arrives as `null`, and the text inside `hr` is cut to the byte count Expat reports.';
export const expected = [
    'gpxtpx:hr 128 131',
    'ns3:hr 128 131',
    'hr in the GPX namespace: 0',
    '{"":"http://www.topografix.com/GPX/1/1","ns3":"http://www.garmin.com/xmlschemas/TrackPointExtension/v1"}',
];
export const init = { useWorker: false };

export default async function example({ XML_ParserCreateNS, XML_SetElementHandler, XML_SetCharacterDataHandler, XML_SetStartNamespaceDeclHandler, XML_Parse, XML_Status, XML_GetErrorCode, XML_ErrorString, XML_GetCurrentLineNumber, XML_GetCurrentColumnNumber, XML_ParserFree, readCString, releaseCallback }, console) {
    const GPX = 'http://www.topografix.com/GPX/1/1';
    const HR = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
    // The same heart rates, written by two exporters that picked different prefixes for Garmin's extension.
    const track = (prefix) => `<gpx version="1.1" creator="example" xmlns="${GPX}" xmlns:${prefix}="${HR}">
        <trk><trkseg>
            <trkpt lat="46.5190" lon="6.5668"><extensions><${prefix}:TrackPointExtension><${prefix}:hr>128</${prefix}:hr></${prefix}:TrackPointExtension></extensions></trkpt>
            <trkpt lat="46.5192" lon="6.5671"><extensions><${prefix}:TrackPointExtension><${prefix}:hr>131</${prefix}:hr></${prefix}:TrackPointExtension></extensions></trkpt>
        </trkseg></trk>
    </gpx>`;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // The text of every element named `local` in the namespace `uri`, and every prefix the document declares.
    const read = (xml, uri, local) => {
        const name = `${uri}|${local}`;
        const open = [];
        const texts = [];
        const declared = {};
        const onStart = (data, element) => {
            if (element === name) open.push('');
        };
        const onEnd = (data, element) => {
            if (element === name) texts.push(open.pop());
        };
        // `text` runs on to the next NUL byte in memory: only its first `length` bytes are this call's.
        const onText = (data, text, length) => {
            if (open.length) open[open.length - 1] += decoder.decode(encoder.encode(text).subarray(0, length));
        };
        const onNamespace = (data, prefix, namespace) => {
            declared[prefix ?? ''] = namespace ?? '';
        };
        // Expat hands every name over as "<namespace URI>|<local name>"; the separator is a C char, so a number here.
        const parser = XML_ParserCreateNS(null, '|'.charCodeAt(0));
        try {
            XML_SetElementHandler(parser, onStart, onEnd);
            XML_SetCharacterDataHandler(parser, onText);
            XML_SetStartNamespaceDeclHandler(parser, onNamespace);
            if (XML_Parse(parser, xml, encoder.encode(xml).length, 1) !== XML_Status.XML_STATUS_OK) {
                throw new Error(`${readCString(XML_ErrorString(XML_GetErrorCode(parser)))} at line ${XML_GetCurrentLineNumber(parser)}, column ${XML_GetCurrentColumnNumber(parser)}`);
            }
            return { texts, declared };
        } finally {
            XML_ParserFree(parser);
            for (const handler of [onStart, onEnd, onText, onNamespace]) releaseCallback(handler);
        }
    };

    for (const prefix of ['gpxtpx', 'ns3']) console.log(`${prefix}:hr`, read(track(prefix), HR, 'hr').texts.join(' '));
    console.log('hr in the GPX namespace:', read(track('gpxtpx'), GPX, 'hr').texts.length);
    console.log(JSON.stringify(read(track('ns3'), HR, 'hr').declared));
}

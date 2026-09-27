export const imports = {
    '@crossbind/port-expat/expat.h': [
        'XML_ParserCreate',
        'XML_SetStartElementHandler',
        'XML_GetBuffer',
        'XML_ParseBuffer',
        'XML_Status',
        'XML_GetErrorCode',
        'XML_ErrorString',
        'XML_GetCurrentLineNumber',
        'XML_GetCurrentColumnNumber',
        'XML_ParserFree',
        'readCString',
        'writeBytes',
        'releaseCallback',
    ],
};
export const note = '`fread` is gone: JavaScript cuts the document into 64 KiB pieces and copies each one into the buffer `XML_GetBuffer` hands out with `writeBytes`, which takes one character per byte, so this ASCII sitemap goes in as it is and other text would have to become a byte string first. The start-element handler is a JavaScript function, so the module runs on the page\'s thread and the handler is freed with `releaseCallback` along with the parser.';
export const expected = ['4389004 B in 67 reads of 64 KiB', 'lastmod 50000', 'loc 50000', 'url 50000', 'urlset 1'];
export const init = { useWorker: false };

export default async function example({ XML_ParserCreate, XML_SetStartElementHandler, XML_GetBuffer, XML_ParseBuffer, XML_Status, XML_GetErrorCode, XML_ErrorString, XML_GetCurrentLineNumber, XML_GetCurrentColumnNumber, XML_ParserFree, readCString, writeBytes, releaseCallback }, console) {
    // A sitemap with 50,000 URLs, the most the sitemap protocol allows in one file.
    const urls = Array.from({ length: 50000 }, (_, i) => `  <url><loc>https://example.com/products/${i + 1}</loc><lastmod>2026-09-${String((i % 28) + 1).padStart(2, '0')}</lastmod></url>`);
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

    const counts = {};
    const onStart = (data, name) => {
        counts[name] = (counts[name] ?? 0) + 1;
    };
    const parser = XML_ParserCreate(null);
    let bytes = 0;
    let reads = 0;
    try {
        XML_SetStartElementHandler(parser, onStart);
        for (let last = false; !last;) {
            // The sitemap is ASCII, so each character is the one byte writeBytes takes.
            const piece = sitemap.slice(bytes, bytes + 65536);
            writeBytes(XML_GetBuffer(parser, 65536), piece);
            last = piece.length === 0;
            bytes += piece.length;
            reads += last ? 0 : 1;
            if (XML_ParseBuffer(parser, piece.length, last) !== XML_Status.XML_STATUS_OK) {
                throw new Error(`${readCString(XML_ErrorString(XML_GetErrorCode(parser)))} at line ${XML_GetCurrentLineNumber(parser)}, column ${XML_GetCurrentColumnNumber(parser)}`);
            }
        }
    } finally {
        XML_ParserFree(parser);
        releaseCallback(onStart);
    }
    console.log(`${bytes} B in ${reads} reads of 64 KiB`);
    for (const name of Object.keys(counts).sort()) console.log(name, counts[name]);
}

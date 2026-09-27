export const title = 'Search text with FTS4';
export const summary =
    'A full-text index with `CREATE VIRTUAL TABLE … USING fts4`, queried with `MATCH` and cut into `snippet()`s. Stemming, phrases, prefixes, `NOT` and `NEAR` come with it. This build has FTS3 and FTS4 but not FTS5.';
export const native = 'search_index.h';
export const expected = [
    'parse -> libcurl [parses] and normalizes URLs exactly like the… | [Parsing] XML with expat',
    '"signing request" -> …key, a certificate [signing] [request] and a self…',
    'brows* -> SQLite in the [browser]',
    'parser NOT expat -> curl URL [parser]',
    'tag NEAR/2 text -> …start tag, end [tag] and [text] run as…',
];

export default async function example({ SearchIndex }, console) {
    const index = await new SearchIndex();
    await index.add('SQLite in the browser', 'SQLite runs inside the browser tab as WebAssembly; queries never leave the page.');
    await index.add('OpenSSL certificates', 'Generate a key, a certificate signing request and a self-signed certificate offline.');
    await index.add('curl URL parser', 'libcurl parses and normalizes URLs exactly like the curl command line tool.');
    await index.add('Parsing XML with expat', 'expat is a stream-oriented parser: it reports each start tag, end tag and text run as it reads.');
    for (const query of ['parse', '"signing request"', 'brows*', 'parser NOT expat', 'tag NEAR/2 text']) {
        console.log(`${query} -> ${await index.search(query)}`);
    }
}

export const title = 'Turn XML into JavaScript objects';
export const summary = 'The calls most Expat code makes: XML_ParserCreate, an element handler and a character data handler, then XML_Parse. A malformed document throws with the line and column where Expat stopped.';
export const native = 'xml_tree.h';
export const expected = ['Expat 2.8.5', '1 en Dune 9.99 EUR', "2 fr L'Étranger 7.50 EUR", '3 en Pride & Prejudice 5.25 GBP', 'mismatched tag at line 2, column 30'];

export default async function example({ XmlTree }, console) {
    console.log('Expat', await XmlTree.version());
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <catalog>
        <book id="1" lang="en"><title>Dune</title><price currency="EUR">9.99</price></book>
        <book id="2" lang="fr"><title>L'Étranger</title><price currency="EUR">7.50</price></book>
        <book id="3" lang="en"><title>Pride &amp; Prejudice</title><price currency="GBP">5.25</price></book>
    </catalog>`;
    const catalog = JSON.parse(await XmlTree.parse(xml));
    for (const book of catalog.children) {
        const [title, price] = book.children;
        console.log(book.attributes.id, book.attributes.lang, title.text, price.text, price.attributes.currency);
    }

    try {
        await XmlTree.parse('<catalog>\n    <book id="4"><title>Emma</book>\n</catalog>');
    } catch (error) {
        console.log(error.cppMessage ?? error.message);
    }
}

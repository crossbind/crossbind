export const title = 'Stream a file through Expat';
export const summary = 'For documents you should not hold in one string: XML_GetBuffer hands out Expat\'s own buffer, fread fills it and XML_ParseBuffer parses it, 64 KiB at a time.';
export const native = 'xml_stream.h';
export const expected = ['4389004 B in 67 reads of 64 KiB', 'lastmod 50000', 'loc 50000', 'url 50000', 'urlset 1'];

export default async function example(m, console) {
    const { XmlStream } = m;
    // A sitemap with 50,000 URLs, the most the sitemap protocol allows in one file.
    const urls = Array.from({ length: 50000 }, (_, i) => `  <url><loc>https://example.com/products/${i + 1}</loc><lastmod>2026-09-${String((i % 28) + 1).padStart(2, '0')}</lastmod></url>`);
    // m.FS.writeFile adds to a file that already exists, so every run gets a fresh directory.
    const dir = await m.getRandomPath('/memfs');
    await m.FS.writeFile(`${dir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

    const stats = JSON.parse(await XmlStream.countElements(`${dir}/sitemap.xml`, 65536));
    console.log(`${stats.bytes} B in ${stats.reads} reads of 64 KiB`);
    for (const [name, count] of Object.entries(stats.elements)) console.log(name, count);
}

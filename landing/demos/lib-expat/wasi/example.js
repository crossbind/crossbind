export const title = 'An XML summary command';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one streams each file through Expat in 64 KiB reads and prints what is inside, or the first error with its line and column.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/xml-stats-wasi-wasm32-st-release.wasm sitemap.xml',
];
export const expected = [
    'sitemap.xml: 4389004 bytes of well-formed XML (expat_2.8.5)',
    '150001 elements, 1 attribute, nested 3 deep',
    'lastmod 50000',
    'loc 50000',
    'url 50000',
    'urlset 1',
];

// The file the command reads: the sitemap the WebAssembly streaming example writes, so the two
// platforms can be compared line for line.
export function input() {
    const urls = Array.from({ length: 50000 }, (_, i) => `  <url><loc>https://example.com/products/${i + 1}</loc><lastmod>2026-09-${String((i % 28) + 1).padStart(2, '0')}</lastmod></url>`);
    return { 'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n` };
}

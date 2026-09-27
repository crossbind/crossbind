export const title = 'Store several pages in one file';
export const summary = 'Scanners and fax software keep a document as one TIFF: every page is a directory closed with TIFFWriteDirectory, listed with TIFFReadDirectory and opened again with TIFFSetDirectory. These pages are 1-bit CCITT Group 4, the fax codec.';
export const native = 'tiff_pages.h';
export const expected = [
    '3 pages in 6133 B',
    'page 1 "cover": 240x320, CCITT Group 4',
    'page 2 "summary": 240x320, CCITT Group 4',
    'page 3 "appendix": 240x320, CCITT Group 4',
    'true',
];

export default async function example({ TiffPages }, console) {
    const width = 240;
    const height = 320;
    const names = ['cover', 'summary', 'appendix'];
    const pages = names.map((name, index) => {
        let grey = ''; // one byte per pixel: a checkerboard whose squares widen page by page
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) grey += String.fromCharCode(((x >> (index + 2)) + (y >> 4)) % 2 ? 0 : 255);
        }
        return grey;
    });
    const scan = await new TiffPages();
    for (const [index, name] of names.entries()) await scan.add(pages[index], width, height, name);
    const tiff = await scan.finish();

    console.log(`${names.length} pages in ${tiff.length} B`);
    for (const line of (await TiffPages.list(tiff)).trimEnd().split('\n')) console.log(line);
    console.log((await TiffPages.grey(tiff, 2)) === pages[2]);
}

export const title = 'Open a TIFF file and print its tags';
export const summary = 'Files reach C++ by path: m.autoMountFiles mounts what an <input type="file"> or a drop gives you, TIFFOpen reads it in place and TIFFPrintDirectory prints every tag, as the tiffinfo tool does.';
export const native = 'tiff_file.h';
export const expected = [
    'photo.tif: 6260 B, 1 page',
    'TIFF Directory at offset 0x17e0 (6112)',
    '  Image Width: 64 Image Length: 48',
    '  Bits/Sample: 8',
    '  Compression Scheme: AdobeDeflate',
    '  Photometric Interpretation: RGB color',
    '  Samples/Pixel: 3',
    '  Rows/Strip: 42',
    '  Planar Configuration: single image plane',
];

export default async function example(m, console) {
    const { Tiff, TiffFile } = m;
    // A File, as an <input type="file"> gives one; this one holds a TIFF made with the first example's class.
    let rgba = '';
    for (let i = 0; i < 64 * 48; i += 1) rgba += String.fromCharCode((i % 64) * 4, (i >> 6) * 5, 128, 255);
    const tiff = await Tiff.encode(rgba, 64, 48, 8); // 8 = Deflate
    const file = new File([Uint8Array.from(tiff, (c) => c.charCodeAt(0))], 'photo.tif', { type: 'image/tiff' });

    const [path] = await m.autoMountFiles([file], await m.getRandomPath('/memfs')); // memory only, gone with the tab
    console.log(`${file.name}: ${file.size} B, ${await TiffFile.pages(path)} page`);
    for (const line of (await TiffFile.directory(path, 0)).trimEnd().split('\n')) console.log(line);
}

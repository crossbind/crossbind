export const title = 'Encode pixels as a TIFF and decode them back';
export const summary = 'The core of libtiff: TIFFSetField and TIFFWriteScanline write a page, TIFFGetField and TIFFReadRGBAImageOriented read it back as display pixels. TIFFStreamOpen keeps the file in memory.';
export const native = 'tiff_codec.h';
export const expected = ['libtiff 4.7.2: 76800 B of RGBA -> 27692 B, starts with II*', '160x120, 3 x 8-bit samples, LZW, 1 page', 'true'];

export default async function example({ Tiff }, console) {
    const width = 160;
    const height = 120;
    let rgba = ''; // one character per byte, in the order ImageData uses
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) rgba += String.fromCharCode(x, 64 + (y >> 5) * 32, 255 - x, 255);
    }
    const tiff = await Tiff.encode(rgba, width, height, 5); // 5 = COMPRESSION_LZW
    console.log(`libtiff ${await Tiff.version()}: ${rgba.length} B of RGBA -> ${tiff.length} B, starts with ${tiff.slice(0, 3)}`);
    console.log(await Tiff.describe(tiff));
    console.log((await Tiff.decode(tiff)) === rgba);
}

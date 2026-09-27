export const title = 'Read and write EXIF and comments';
export const summary = 'jpeg_save_markers keeps the APPn and COM segments libjpeg-turbo would otherwise skip, and jpeg_write_marker adds new ones. Here an EXIF orientation and a comment go in without re-encoding the image.';
export const native = 'jpeg_markers.h';
export const expected = ['APP0 JFIF 14 B, APP1 Exif 32 B, COM 19 B', 'orientation 6, comment "made with crossbind", 59 B added'];

export default async function example({ JpegMarkers, JpegEncoder }, console) {
    const [width, height] = [100, 75];
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
        rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
    }
    const jpeg = await JpegEncoder.encode(String.fromCharCode(...rgba), width, height, 90, 420); // the first example's encoder

    const tagged = await JpegMarkers.tag(jpeg, 6, 'made with crossbind');
    const info = JSON.parse(await JpegMarkers.read(tagged));
    console.log(info.markers.map(({ marker, label, bytes }) => [marker, label, `${bytes} B`].filter(Boolean).join(' ')).join(', '));
    console.log(`orientation ${info.orientation}, comment "${info.comment}", ${tagged.length - jpeg.length} B added`);
}

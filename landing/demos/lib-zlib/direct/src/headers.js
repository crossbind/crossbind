// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    adler32,
    adler32_combine,
    allocBuffer,
    compress2,
    compressBound,
    crc32,
    crc32_combine,
    gzclose,
    gzerror,
    gzopen,
    gzread,
    gzwrite,
    readBytes,
    readNumberAt,
    uncompress,
    writeBytes,
    writeNumberAt,
    zError,
    zlibVersion,
} from '@crossbind/port-zlib/zlib.h';

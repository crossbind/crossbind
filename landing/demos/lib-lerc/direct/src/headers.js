// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    lerc_computeCompressedSize,
    lerc_decode,
    lerc_encode,
    lerc_getBlobInfo,
    allocBuffer,
    readBytes,
    readNumberAt,
    writeBytes,
} from '@crossbind/port-lerc/Lerc_c_api.h';

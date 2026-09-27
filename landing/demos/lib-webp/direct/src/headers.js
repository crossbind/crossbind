// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    WebPEncodeLosslessRGBA,
    WebPEncodeRGBA,
    WebPGetEncoderVersion,
    allocBuffer,
    allocPointer,
    readBytes,
    readNumberAt,
    readPointerAt,
    writeBytes,
} from '@crossbind/port-webp/webp/encode.h';
export { VP8StatusCode, WebPBitstreamFeatures, WebPDecodeRGBA, WebPGetFeatures, WebPGetInfo } from '@crossbind/port-webp/webp/decode.h';
export { WebPFree } from '@crossbind/port-webp/webp/types.h';

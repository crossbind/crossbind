// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    ZSTD_compress,
    ZSTD_compress2,
    ZSTD_compress_usingCDict,
    ZSTD_compressBound,
    ZSTD_CCtx_setParameter,
    ZSTD_cParameter,
    ZSTD_createCCtx,
    ZSTD_createCDict,
    ZSTD_createDCtx,
    ZSTD_createDDict,
    ZSTD_decompress,
    ZSTD_decompress_usingDDict,
    ZSTD_freeCCtx,
    ZSTD_freeCDict,
    ZSTD_freeDCtx,
    ZSTD_freeDDict,
    ZSTD_getErrorName,
    ZSTD_getFrameContentSize,
    ZSTD_isError,
    ZSTD_versionString,
    allocBuffer,
    readBytes,
    writeBytes,
} from '@crossbind/port-zstd/zstd.h';
export { ZDICT_getErrorName, ZDICT_isError, ZDICT_trainFromBuffer } from '@crossbind/port-zstd/zdict.h';

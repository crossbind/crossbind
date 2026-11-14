// Libraries left out of the link. GDAL's own code reaches them whichever drivers the
// module registers (its network file systems reach curl and OpenSSL), so leaving out what
// these examples never call keeps the wasm about 12 MB smaller. Calling into a library
// left out aborts with "missing function". zstd stays in: the COG driver calls it even when it
// writes Deflate. GEOS stays in too: a spatial filter makes OGR build a GEOS prepared
// geometry.
export default {
    curl: { exclude: true },
    openssl: { exclude: true },
    spatialite: { exclude: true },
    webp: { exclude: true },
    Lerc: { exclude: true },
    jpeg: { exclude: true },
    expat: { exclude: true },
    iconv: { exclude: true },
};

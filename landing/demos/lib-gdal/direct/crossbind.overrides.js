// Libraries left out of the link. Binding gdal.h links GDALAllRegister and so every
// driver GDAL was built with; leaving out what these examples never call keeps the wasm
// under the 25 MiB a file the site's host accepts. Calling into a library left out
// aborts with "missing function". zstd stays in: the COG driver calls it even when it
// writes Deflate.
export default {
    curl: { exclude: true },
    openssl: { exclude: true },
    spatialite: { exclude: true },
    webp: { exclude: true },
    Lerc: { exclude: true },
    jpeg: { exclude: true },
    expat: { exclude: true },
    geos: { exclude: true },
    iconv: { exclude: true },
};

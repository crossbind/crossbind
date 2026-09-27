// Libraries left out of this module's link. A page has no raw sockets, so curl and OpenSSL could never
// fetch anything; GDAL calls SpatiaLite only when SPATIALITE_LOAD is not FALSE; no app here reads or
// writes WebP, LERC or JPEG. Calling into an excluded library aborts.
export default {
    curl: { exclude: true },
    openssl: { exclude: true },
    spatialite: { exclude: true },
    webp: { exclude: true },
    Lerc: { exclude: true },
    jpeg: { exclude: true },
};

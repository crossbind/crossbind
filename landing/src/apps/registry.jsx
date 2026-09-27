import { CURL_APPS } from './curl.jsx';
import { EXPAT_APPS } from './expat.jsx';
import { GDAL_APPS } from './gdal.jsx';
import { GEOS_APPS } from './geos.jsx';
import { GEOTIFF_APPS } from './geotiff.jsx';
import { ICONV_APPS } from './iconv.jsx';
import { JPEGTURBO_APPS } from './jpegturbo.jsx';
import { LERC_APPS } from './lerc.jsx';
import { OPENSSL_APPS } from './openssl.jsx';
import { PROJ_APPS } from './proj.jsx';
import { SPATIALITE_APPS } from './spatialite.jsx';
import { SQLITE3_APPS } from './sqlite3.jsx';
import { TIFF_APPS } from './tiff.jsx';
import { WEBP_APPS } from './webp.jsx';
import { ZLIB_APPS } from './zlib.jsx';
import { ZSTD_APPS } from './zstd.jsx';

// family -> the live apps its /ports/<family>/ page runs. `demo` is the id of the library's module
// in scripts/site/build-example-demos.mjs; each app is a component carrying a stable `appId`.
export const LIBRARY_APPS = {
    curl: {
        demo: 'lib-curl',
        headline: "libcurl's own parsers in your browser, next to the browser's",
        lede: "In a browser this port hands curl_easy_perform to fetch, so curl's own transfers do not run here; its parsers do. These apps run libcurl 8.22.0, compiled by crossbind, beside the browser's URL and Date.parse: they find URLs that pass a JavaScript allowlist yet send libcurl to another host, take any URL apart both ways, and read HTTP dates the way curl does.",
        apps: CURL_APPS,
    },
    expat: {
        demo: 'lib-expat',
        headline: 'Expat in your browser, for XML that DOMParser cannot take',
        lede: 'Browsers parse XML with DOMParser, which needs the whole document as one string and does not exist in Web Workers. These apps run the upstream Expat C library, compiled by crossbind, inside the Worker: they stream a gigabyte with flat memory, stop billion laughs at a line and column, and read GPS tracks by namespace.',
        apps: EXPAT_APPS,
    },
    gdal: {
        demo: 'lib-gdal',
        headline: 'GDAL in your browser: twenty vector formats, terrain analysis and pixels to polygons',
        lede: "GDAL is the format library behind QGIS, PostGIS, MapServer and rasterio. These apps run GDAL 3.13.3, compiled by crossbind: they read twenty vector formats and write seventeen, with reprojection, from zipped Shapefiles to Esri File Geodatabases; they shade and contour a terrain and compute what is seen from a point; and they trace painted pixels into polygons. The page registers 25 of the port's 180 drivers, one by one. GDAL is MIT; the module also contains GEOS and libiconv, which are LGPL, and every app links their sources.",
        apps: GDAL_APPS,
    },
    geos: {
        demo: 'lib-geos',
        headline: 'The geometry engine behind PostGIS, in your browser',
        lede: 'GEOS is the C++ library PostGIS, QGIS, GDAL and Shapely call for overlays, validity checks and simplification. These apps run it, compiled by crossbind, on shapes you type: fifteen operations with the DE-9IM relation of two shapes, a diagnosis and two repairs for broken polygons, and a map simplified without opening gaps between regions. GEOS is LGPL-2.1; every app links its source.',
        apps: GEOS_APPS,
    },
    geotiff: {
        demo: 'lib-geotiff',
        headline: 'libgeotiff in your browser: where a GeoTIFF is, and GeoTIFFs that GDAL places',
        lede: "libgeotiff is the GeoTIFF library GDAL's GTiff driver is built on. These apps run libgeotiff 1.7.4 with libtiff and PROJ, compiled by crossbind: they name any GeoTIFF's coordinate system and draw its footprint on a map, turn a picture and a bounding box into a compressed GeoTIFF that GDAL places where you said, and read heights and degrees off an elevation model. Most of the first run's download is PROJ's data, 10.2 MB, chiefly the EPSG database proj.db, which libgeotiff reads to name coordinate systems.",
        apps: GEOTIFF_APPS,
    },
    iconv: {
        demo: 'lib-iconv',
        headline: 'libiconv in your browser: write what TextEncoder cannot, read what TextDecoder refuses',
        lede: "TextDecoder reads the Encoding Standard's list and TextEncoder writes only UTF-8. These apps run GNU libiconv 1.19, compiled by crossbind: they repair text opened with the wrong encoding, write byte-exact Shift_JIS, GB18030 or Windows-125x files, and read ISO-2022-KR, UTF-7, EUC-TW and the rest of its 112 encodings. libiconv is LGPL-2.1-or-later.",
        apps: ICONV_APPS,
    },
    jpegturbo: {
        demo: 'lib-jpegturbo',
        headline: 'libjpeg-turbo in your browser: the JPEG controls canvas does not give you',
        lede: "Browsers decode JPEG, and encode it through canvas.toBlob with a single quality number. These apps run the reference JPEG library, compiled by crossbind: they strip a photo's location and camera data without re-encoding it, expose every encoder setting next to this browser's own, and decode a 12 MP photo straight to a thumbnail.",
        apps: JPEGTURBO_APPS,
    },
    lerc: {
        demo: 'lib-lerc',
        headline: 'LERC in your browser: rasters stored to the error you choose',
        lede: "LERC, from Esri, stores rasters such as elevation so that no value moves by more than the error you pick; ArcGIS elevation services send their tiles in it, and GDAL's GeoTIFF and MRF drivers read and write it. Esri's own lerc package on npm and loaders.gl only decode it. These apps run Esri's C++ library, compiled by crossbind: they encode a terrain at six error budgets and check every height, open LERC tiles, and compare LERC with the browser's gzip.",
        apps: LERC_APPS,
    },
    openssl: {
        demo: 'lib-openssl',
        headline: 'OpenSSL 4 in your browser: certificates, TLS and .p12 files that WebCrypto does not handle',
        lede: "WebCrypto hashes, signs and encrypts, but it reads no certificates, opens no .p12 files and speaks no TLS. These apps run OpenSSL 4.0.2 itself, compiled by crossbind: they make keys and certificates, post-quantum ML-DSA ones included, run a TLS 1.3 handshake between two OpenSSL endpoints in the tab with OpenSSL's default hybrid ML-KEM key exchange and Encrypted Client Hello, and open .p12 files, old RC2-40 ones too. OpenSSL is Apache-2.0.",
        apps: OPENSSL_APPS,
    },
    proj: {
        demo: 'lib-proj',
        headline: 'The coordinate engine behind QGIS and PostGIS, in your browser',
        lede: "PROJ is the library GDAL, QGIS, PostGIS and pyproj call to convert coordinates between reference systems. These apps run PROJ 9.9.0, compiled by crossbind, with the EPSG registry v13.102 in its proj.db: any projected CRS drawn with what it distorts, a .prj traced to its EPSG code and to every transformation path PROJ knows, and the shortest flight route next to the one that holds a compass heading. proj.db, PROJ's 10-megabyte database, is most of the download.",
        apps: PROJ_APPS,
    },
    spatialite: {
        demo: 'lib-spatialite',
        headline: 'SpatiaLite in your browser: spatial SQL, routing and GeoPackage, with no server',
        lede: "SpatiaLite adds PostGIS-style spatial SQL to SQLite: spatial indexes, joins, reprojection and routing in one database file. These apps run SpatiaLite 5.1.0, compiled by crossbind with GEOS, PROJ and SQLite: a SQL playground that draws what each query returns, shortest paths around the streets you close, and a GeoPackage that GDAL and QGIS open. PROJ's database, which ST_Transform reads, is 10.2 MB of the download. This build leaves out RTTOPO, which would make SpatiaLite GPL-only, so ST_MakeValid is GeosMakeValid here.",
        apps: SPATIALITE_APPS,
    },
    sqlite3: {
        demo: 'lib-sqlite3',
        headline: 'SQLite in your browser, with your C++ running beside it',
        lede: 'These apps run SQLite 3.53.4, compiled by crossbind, next to small C++ wrappers: a BM25 ranking function that FTS4 lacks, an R*Tree timed against a B-tree and a table scan, and a read-only explorer for database files you open.',
        apps: SQLITE3_APPS,
    },
    tiff: {
        demo: 'lib-tiff',
        headline: 'TIFF in any browser, from fax pages to float elevation models',
        lede: 'MDN lists Safari as the only browser that shows TIFF images by itself. These apps run libtiff, compiled by crossbind: they open multi-page, 16-bit and float TIFFs with their tags, turn page photos into one fax-grade archive, and compare every codec on scientific rasters.',
        apps: TIFF_APPS,
    },
    webp: {
        demo: 'lib-webp',
        headline: 'WebP encoding with the controls a canvas does not have',
        lede: "Every current browser displays WebP, but a canvas can only encode it at a quality, and Safari's canvas cannot encode it at all. These apps run libwebp 1.6.0 itself, compiled by crossbind: they show what each quality costs and gives away, fit a sticker under a byte budget, and decode a file as its bytes arrive.",
        apps: WEBP_APPS,
    },
    zlib: {
        demo: 'lib-zlib',
        headline: 'zlib in your browser, with the controls CompressionStream leaves out',
        lede: 'Browsers gzip and gunzip with CompressionStream, but it takes no level, no dictionary and no header fields, and it can only start at the first byte. These apps run the upstream zlib 1.3.2, compiled by crossbind: they jump into the middle of a big .gz, shrink PNGs without touching a pixel, and read ZIP-based files one entry at a time.',
        apps: ZLIB_APPS,
    },
    zstd: {
        demo: 'lib-zstd',
        headline: 'zstd in your browser, including what no browser API does',
        lede: 'Browsers decode zstd on the network, but none gives JavaScript a zstd compressor by default. These apps run the upstream C library, compiled by crossbind: they train dictionaries, send an update as its difference from the last version, and stream .tar.zst archives.',
        apps: ZSTD_APPS,
    },
};

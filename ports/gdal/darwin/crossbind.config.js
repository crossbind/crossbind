import mergeConfig from '@crossbind/port-gdal/mergeConfig.mjs';
import curlDarwin from '@crossbind/port-curl-darwin/crossbind.config.js';
import expatDarwin from '@crossbind/port-expat-darwin/crossbind.config.js';
import geosDarwin from '@crossbind/port-geos-darwin/crossbind.config.js';
import geotiffDarwin from '@crossbind/port-geotiff-darwin/crossbind.config.js';
import iconvDarwin from '@crossbind/port-iconv-darwin/crossbind.config.js';
import jpegturboDarwin from '@crossbind/port-jpegturbo-darwin/crossbind.config.js';
import zstdDarwin from '@crossbind/port-zstd-darwin/crossbind.config.js';
import lercDarwin from '@crossbind/port-lerc-darwin/crossbind.config.js';
import projDarwin from '@crossbind/port-proj-darwin/crossbind.config.js';
import spatialiteDarwin from '@crossbind/port-spatialite-darwin/crossbind.config.js';
import sqlite3Darwin from '@crossbind/port-sqlite3-darwin/crossbind.config.js';
import tiffDarwin from '@crossbind/port-tiff-darwin/crossbind.config.js';
import webpDarwin from '@crossbind/port-webp-darwin/crossbind.config.js';
import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';

export default mergeConfig({
    dependencies: [
        curlDarwin,
        expatDarwin,
        geosDarwin,
        geotiffDarwin,
        iconvDarwin,
        jpegturboDarwin,
        zstdDarwin,
        lercDarwin,
        projDarwin,
        spatialiteDarwin,
        sqlite3Darwin,
        tiffDarwin,
        webpDarwin,
        zlibDarwin,
    ],
    paths: { config: import.meta.url },
});

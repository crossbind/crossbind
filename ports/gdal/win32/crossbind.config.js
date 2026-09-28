import mergeConfig from '@crossbind/port-gdal/mergeConfig.mjs';
import curlWin32 from '@crossbind/port-curl-win32/crossbind.config.js';
import expatWin32 from '@crossbind/port-expat-win32/crossbind.config.js';
import geosWin32 from '@crossbind/port-geos-win32/crossbind.config.js';
import geotiffWin32 from '@crossbind/port-geotiff-win32/crossbind.config.js';
import iconvWin32 from '@crossbind/port-iconv-win32/crossbind.config.js';
import jpegturboWin32 from '@crossbind/port-jpegturbo-win32/crossbind.config.js';
import zstdWin32 from '@crossbind/port-zstd-win32/crossbind.config.js';
import lercWin32 from '@crossbind/port-lerc-win32/crossbind.config.js';
import projWin32 from '@crossbind/port-proj-win32/crossbind.config.js';
import spatialiteWin32 from '@crossbind/port-spatialite-win32/crossbind.config.js';
import sqlite3Win32 from '@crossbind/port-sqlite3-win32/crossbind.config.js';
import tiffWin32 from '@crossbind/port-tiff-win32/crossbind.config.js';
import webpWin32 from '@crossbind/port-webp-win32/crossbind.config.js';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';

export default mergeConfig({
    dependencies: [
        curlWin32,
        expatWin32,
        geosWin32,
        geotiffWin32,
        iconvWin32,
        jpegturboWin32,
        zstdWin32,
        lercWin32,
        projWin32,
        spatialiteWin32,
        sqlite3Win32,
        tiffWin32,
        webpWin32,
        zlibWin32,
    ],
    paths: { config: import.meta.url },
});

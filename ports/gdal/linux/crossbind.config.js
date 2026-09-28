import mergeConfig from '@crossbind/port-gdal/mergeConfig.mjs';
import curlLinux from '@crossbind/port-curl-linux/crossbind.config.js';
import expatLinux from '@crossbind/port-expat-linux/crossbind.config.js';
import geosLinux from '@crossbind/port-geos-linux/crossbind.config.js';
import geotiffLinux from '@crossbind/port-geotiff-linux/crossbind.config.js';
import iconvLinux from '@crossbind/port-iconv-linux/crossbind.config.js';
import jpegturboLinux from '@crossbind/port-jpegturbo-linux/crossbind.config.js';
import zstdLinux from '@crossbind/port-zstd-linux/crossbind.config.js';
import lercLinux from '@crossbind/port-lerc-linux/crossbind.config.js';
import projLinux from '@crossbind/port-proj-linux/crossbind.config.js';
import spatialiteLinux from '@crossbind/port-spatialite-linux/crossbind.config.js';
import sqlite3Linux from '@crossbind/port-sqlite3-linux/crossbind.config.js';
import tiffLinux from '@crossbind/port-tiff-linux/crossbind.config.js';
import webpLinux from '@crossbind/port-webp-linux/crossbind.config.js';
import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';

export default mergeConfig({
    dependencies: [
        curlLinux,
        expatLinux,
        geosLinux,
        geotiffLinux,
        iconvLinux,
        jpegturboLinux,
        zstdLinux,
        lercLinux,
        projLinux,
        spatialiteLinux,
        sqlite3Linux,
        tiffLinux,
        webpLinux,
        zlibLinux,
    ],
    paths: { config: import.meta.url },
});

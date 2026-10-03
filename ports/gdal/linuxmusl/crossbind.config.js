import mergeConfig from '@crossbind/port-gdal/mergeConfig.mjs';
import curlLinuxmusl from '@crossbind/port-curl-linuxmusl/crossbind.config.js';
import expatLinuxmusl from '@crossbind/port-expat-linuxmusl/crossbind.config.js';
import geosLinuxmusl from '@crossbind/port-geos-linuxmusl/crossbind.config.js';
import geotiffLinuxmusl from '@crossbind/port-geotiff-linuxmusl/crossbind.config.js';
import iconvLinuxmusl from '@crossbind/port-iconv-linuxmusl/crossbind.config.js';
import jpegturboLinuxmusl from '@crossbind/port-jpegturbo-linuxmusl/crossbind.config.js';
import zstdLinuxmusl from '@crossbind/port-zstd-linuxmusl/crossbind.config.js';
import lercLinuxmusl from '@crossbind/port-lerc-linuxmusl/crossbind.config.js';
import projLinuxmusl from '@crossbind/port-proj-linuxmusl/crossbind.config.js';
import spatialiteLinuxmusl from '@crossbind/port-spatialite-linuxmusl/crossbind.config.js';
import sqlite3Linuxmusl from '@crossbind/port-sqlite3-linuxmusl/crossbind.config.js';
import tiffLinuxmusl from '@crossbind/port-tiff-linuxmusl/crossbind.config.js';
import webpLinuxmusl from '@crossbind/port-webp-linuxmusl/crossbind.config.js';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';

export default mergeConfig({
    dependencies: [
        curlLinuxmusl,
        expatLinuxmusl,
        geosLinuxmusl,
        geotiffLinuxmusl,
        iconvLinuxmusl,
        jpegturboLinuxmusl,
        zstdLinuxmusl,
        lercLinuxmusl,
        projLinuxmusl,
        spatialiteLinuxmusl,
        sqlite3Linuxmusl,
        tiffLinuxmusl,
        webpLinuxmusl,
        zlibLinuxmusl,
    ],
    paths: { config: import.meta.url },
});

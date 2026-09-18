import curl from '@crossbind/port-curl-wasm/crossbind.config.js';
import { conformanceExport } from '@crossbind/conformance/config.mjs';
import expat from '@crossbind/port-expat-wasm/crossbind.config.js';
import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';
import geos from '@crossbind/port-geos-wasm/crossbind.config.js';
import geotiff from '@crossbind/port-geotiff-wasm/crossbind.config.js';
import iconv from '@crossbind/port-iconv-wasm/crossbind.config.js';
import openssl from '@crossbind/port-openssl-wasm/crossbind.config.js';
import proj from '@crossbind/port-proj-wasm/crossbind.config.js';
import spatialite from '@crossbind/port-spatialite-wasm/crossbind.config.js';
import sqlite3 from '@crossbind/port-sqlite3-wasm/crossbind.config.js';
import tiff from '@crossbind/port-tiff-wasm/crossbind.config.js';
import webp from '@crossbind/port-webp-wasm/crossbind.config.js';
import zlib from '@crossbind/port-zlib-wasm/crossbind.config.js';
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';

export default {
    general: {
        name: 'crossbind-example-backend-nodejs-wasm',
    },
    dependencies: [
        curl,
        expat,
        gdal,
        geos,
        geotiff,
        iconv,
        openssl,
        proj,
        spatialite,
        sqlite3,
        tiff,
        webp,
        zlib,
        embindRustDemo,
        conformanceRust,
    ],
    // The conformance kit's headers need a prelude and an ignored declaration on every leg.
    export: conformanceExport,
    paths: {
        config: import.meta.url,
        base: '../..', /* Delete this line for create-crossbind */
        output: 'dist',
        // The conformance kit's header lives in its own workspace package; the standalone
        // build bridges every .h found on this list.
        header: ['src/native', '../conformance/native'],
    },
    targetSpecs: [
        {
            platform: 'wasm',
            specs: {
                binary: {
                    emccFlags: ['-sJSPI'],
                }
            }
        }
    ],
    target: {
        runtime: 'mt',
    },
};

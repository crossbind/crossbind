import matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';
// embind-rust demo: a Rust producer built via buildType 'cargo', consumed as a prebuilt dep.
import embindRustDemo from '@crossbind/embind-rust-demo/crossbind.config.mjs';
import conformanceRust from '@crossbind/conformance-rust/crossbind.config.mjs';
import curlAndroid from '@crossbind/port-curl-android/crossbind.config.js';
import curlIos from '@crossbind/port-curl-ios/crossbind.config.js';
import expatAndroid from '@crossbind/port-expat-android/crossbind.config.js';
import expatIos from '@crossbind/port-expat-ios/crossbind.config.js';
import gdalAndroid from '@crossbind/port-gdal-android/crossbind.config.js';
import gdalIos from '@crossbind/port-gdal-ios/crossbind.config.js';
import geosAndroid from '@crossbind/port-geos-android/crossbind.config.js';
import geosIos from '@crossbind/port-geos-ios/crossbind.config.js';
import geotiffAndroid from '@crossbind/port-geotiff-android/crossbind.config.js';
import geotiffIos from '@crossbind/port-geotiff-ios/crossbind.config.js';
import iconvAndroid from '@crossbind/port-iconv-android/crossbind.config.js';
import iconvIos from '@crossbind/port-iconv-ios/crossbind.config.js';
import opensslAndroid from '@crossbind/port-openssl-android/crossbind.config.js';
import opensslIos from '@crossbind/port-openssl-ios/crossbind.config.js';
import projAndroid from '@crossbind/port-proj-android/crossbind.config.js';
import projIos from '@crossbind/port-proj-ios/crossbind.config.js';
import spatialiteAndroid from '@crossbind/port-spatialite-android/crossbind.config.js';
import spatialiteIos from '@crossbind/port-spatialite-ios/crossbind.config.js';
import sqlite3Android from '@crossbind/port-sqlite3-android/crossbind.config.js';
import sqlite3Ios from '@crossbind/port-sqlite3-ios/crossbind.config.js';
import tiffAndroid from '@crossbind/port-tiff-android/crossbind.config.js';
import tiffIos from '@crossbind/port-tiff-ios/crossbind.config.js';
import webpAndroid from '@crossbind/port-webp-android/crossbind.config.js';
import webpIos from '@crossbind/port-webp-ios/crossbind.config.js';
import zlibAndroid from '@crossbind/port-zlib-android/crossbind.config.js';
import zlibIos from '@crossbind/port-zlib-ios/crossbind.config.js';
import { conformanceExport } from '@crossbind/conformance/config.mjs';

export default {
    // Upstream crates available to app-local .rs surfaces (src/native/*.rs) - the Rust
    // analog of linking a C library and using it from your own native.h classes.
    cargoDependencies: {
        geo: '0.29',
        wkt: '0.11',
        // Direct crate imports (`import { Uuid } from 'cargo:uuid'`): bridged from crate sources.
        uuid: '{ version = "1", features = ["v4"] }',
        semver: '1',
        regex: '1',
    },
    dependencies: [
        matrix,
        embindRustDemo,
        conformanceRust,
        curlAndroid,
        curlIos,
        expatAndroid,
        expatIos,
        gdalAndroid,
        gdalIos,
        geosAndroid,
        geosIos,
        geotiffAndroid,
        geotiffIos,
        iconvAndroid,
        iconvIos,
        opensslAndroid,
        opensslIos,
        projAndroid,
        projIos,
        spatialiteAndroid,
        spatialiteIos,
        sqlite3Android,
        sqlite3Ios,
        tiffAndroid,
        tiffIos,
        webpAndroid,
        webpIos,
        zlibAndroid,
        zlibIos,
    ],
    export: conformanceExport,
    paths: {
        config: import.meta.url,
        base: '../..', /* Delete this line for create-crossbind */
        // The conformance kit's header lives in its own workspace package; listing its dir
        // here feeds swig and the native bridge compile include path.
        header: ['src/native', '../conformance/native'],
    }
}

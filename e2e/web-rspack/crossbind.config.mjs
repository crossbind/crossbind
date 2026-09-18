import matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';
import { conformanceExport } from '@crossbind/conformance/config.mjs';
import curl from '@crossbind/port-curl-wasm/crossbind.config.js';
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
        name: 'crossbind-e2e-web-rspack',
    },
    // Direct crate imports (`import { Uuid } from 'cargo:uuid'`) + upstream crates for
    // the app-local geo_surface.rs - both bridged from crate sources, no packages.
    cargoDependencies: {
        uuid: '{ version = "1", features = ["v4"] }',
        geo: '0.29',
        wkt: '0.11',
        semver: '1',
        regex: '1',
    },
    dependencies: [
        matrix,
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
        // The conformance kit's header lives in its own workspace package; listing its dir
        // here feeds both SWIG's -I and the CMake HEADER_DIR pipe.
        header: ['src/native', '../conformance/native'],
    },
    // No -sJSPI here: this playground builds the mt (pthreads) browser runtime,
    // and JSPI cannot ride along (pthread-mailbox suspends throw SuspendError in
    // Chromium; Playwright's Firefox has no JSPI API). The shared ops_JSPI demo
    // is guarded out of non-JSPI builds by the bridge generator.
    target: {
        runtime: 'mt',
    }
};

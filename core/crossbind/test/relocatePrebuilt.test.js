import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import relocatePrebuilt from '../src/utils/relocatePrebuilt.js';

const TARGET = 'linux-x64-mt-release';
const DOCKER_BASE = '/tmp/crossbind/live';
const DOCKER_PREFIX = `${DOCKER_BASE}/zstd/linux/.crossbind/build/Source-Release/prebuilt/${TARGET}`;
const OPENSSL_LIB = `${DOCKER_BASE}/openssl/linux/dist/prebuilt/${TARGET}/lib`;

let work;
let prefixDir;
let hostPrefix;

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-relocate-')));
    prefixDir = upath.join(work, 'dist/prebuilt', TARGET);
    hostPrefix = upath.join(work, '.crossbind/build/Source-Release/prebuilt', TARGET);
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function put(relative, content) {
    const file = upath.join(prefixDir, relative);
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

const read = (relative) => fs.readFileSync(upath.join(prefixDir, relative), 'utf8');

function relocate() {
    relocatePrebuilt(prefixDir, {
        installPrefixes: [hostPrefix, DOCKER_PREFIX],
        buildBases: [work, DOCKER_BASE],
    });
}

describe('relocatePrebuilt', () => {
    test('points a pkg-config prefix at the directory of the .pc file', () => {
        put('lib/pkgconfig/libzstd.pc', `prefix=${DOCKER_PREFIX}\nlibdir=\${prefix}/lib\nLibs: -L\${libdir} -lzstd\n`);

        relocate();

        expect(read('lib/pkgconfig/libzstd.pc')).toBe('prefix=${pcfiledir}/../..\nlibdir=${prefix}/lib\nLibs: -L${libdir} -lzstd\n');
    });

    // GDAL repeats its prefix inside the flag variables instead of deriving them from ${prefix}.
    test('rewrites every copy of the prefix, including those inside flags', () => {
        put('lib/pkgconfig/gdal.pc', [
            `CONFIG_INST_PREFIX=${hostPrefix}`,
            `CONFIG_INST_LIBS=-L${hostPrefix}/lib -lgdal`,
            `CONFIG_INST_DATA=${hostPrefix}/share/gdal`,
            '',
        ].join('\n'));

        relocate();

        expect(read('lib/pkgconfig/gdal.pc')).toBe([
            'CONFIG_INST_PREFIX=${pcfiledir}/../..',
            'CONFIG_INST_LIBS=-L${pcfiledir}/../../lib -lgdal',
            'CONFIG_INST_DATA=${pcfiledir}/../../share/gdal',
            '',
        ].join('\n'));
    });

    // spatialite records the -L that geos-config printed while it was being built.
    test('drops search paths into other packages and names their archives in pkg-config files', () => {
        put('lib/pkgconfig/spatialite.pc', [
            `prefix=${DOCKER_PREFIX}`,
            `Libs: -L\${libdir} -lspatialite -lgeos -L${DOCKER_BASE}/geos/linux/.crossbind/build/Source-Release/prebuilt/${TARGET}/lib -lproj ${OPENSSL_LIB}/libssl.a`,
            `Cflags: -I\${includedir} -I${DOCKER_BASE}/geos/linux/dist/prebuilt/${TARGET}/include`,
            '',
        ].join('\n'));

        relocate();

        expect(read('lib/pkgconfig/spatialite.pc')).toBe([
            'prefix=${pcfiledir}/../..',
            'Libs: -L${libdir} -lspatialite -lgeos -lproj -lssl',
            'Cflags: -I${includedir}',
            '',
        ].join('\n'));
    });

    // GEOS and Lerc templates hardcode libstdc++; every crossbind toolchain links libc++.
    test('names libc++ where upstream metadata names libstdc++', () => {
        put('lib/pkgconfig/geos.pc', `prefix=${DOCKER_PREFIX}\nLibs.private: -lgeos -lstdc++ -lm\n`);
        put('bin/geos-config', '#!/bin/sh\nprefix=/usr\necho "-L${prefix}/lib -lgeos -lstdc++"\n');

        relocate();
        relocate();

        expect(read('lib/pkgconfig/geos.pc')).toBe('prefix=${pcfiledir}/../..\nLibs.private: -lgeos -lc++ -lm\n');
        expect(read('bin/geos-config')).toBe('#!/bin/sh\nprefix=/usr\necho "-L${prefix}/lib -lgeos -lc++"\n');
    });

    test('counts the way back from a pkg-config directory at any depth', () => {
        put('share/pkgconfig/a.pc', `prefix=${DOCKER_PREFIX}\n`);
        put('lib/x86_64-linux-gnu/pkgconfig/b.pc', `prefix=${DOCKER_PREFIX}\n`);

        relocate();

        expect(read('share/pkgconfig/a.pc')).toBe('prefix=${pcfiledir}/../..\n');
        expect(read('lib/x86_64-linux-gnu/pkgconfig/b.pc')).toBe('prefix=${pcfiledir}/../../..\n');
    });

    test('rewrites single-quoted, double-quoted and bare prefixes in -config scripts', () => {
        put('bin/demo-config', [
            '#!/bin/sh',
            `prefix='${DOCKER_PREFIX}'`,
            `CONFIG_LIBS="-L${DOCKER_PREFIX}/lib -ldemo"`,
            `datadir=${DOCKER_PREFIX}/share/demo`,
            'echo "$prefix|$CONFIG_LIBS|$datadir"',
            '',
        ].join('\n'));

        relocate();

        expect(read('bin/demo-config')).toBe([
            '#!/bin/sh',
            'crossbind_prefix=$(cd "$(dirname "$0")/.." && pwd)',
            'prefix="${crossbind_prefix}"',
            'CONFIG_LIBS="-L${crossbind_prefix}/lib -ldemo"',
            'datadir="${crossbind_prefix}/share/demo"',
            'echo "$prefix|$CONFIG_LIBS|$datadir"',
            '',
        ].join('\n'));
    });

    test.skipIf(process.platform === 'win32')('a relocated -config script answers with its own location', () => {
        const script = put('bin/demo-config', [
            '#!/bin/sh',
            `prefix='${DOCKER_PREFIX}'`,
            `CONFIG_LIBS="-L${DOCKER_PREFIX}/lib -ldemo"`,
            'echo "$prefix|$CONFIG_LIBS"',
            '',
        ].join('\n'));
        fs.chmodSync(script, 0o755);

        relocate();

        expect(execFileSync('sh', [script], { encoding: 'utf8' }).trim()).toBe(`${prefixDir}|-L${prefixDir}/lib -ldemo`);
        expect(fs.statSync(script).mode & 0o111).not.toBe(0);
    });

    // CMake installs programs without the owner write bit.
    test.skipIf(process.platform === 'win32')('rewrites read-only files and keeps their modes', () => {
        const script = put('bin/demo-config', `#!/bin/sh\nprefix=${DOCKER_PREFIX}\n`);
        const pc = put('lib/pkgconfig/demo.pc', `prefix=${DOCKER_PREFIX}\n`);
        fs.chmodSync(script, 0o555);
        fs.chmodSync(pc, 0o444);

        relocate();

        expect(read('bin/demo-config')).toContain('prefix="${crossbind_prefix}"');
        expect(read('lib/pkgconfig/demo.pc')).toBe('prefix=${pcfiledir}/../..\n');
        expect(fs.statSync(script).mode & 0o777).toBe(0o555);
        expect(fs.statSync(pc).mode & 0o777).toBe(0o444);
    });

    test('leaves an assignment it cannot quote safely for the publish gate to report', () => {
        const line = `flags=-I'${DOCKER_PREFIX}'/include`;
        put('bin/odd-config', `#!/bin/sh\n${line}\n`);

        relocate();

        expect(read('bin/odd-config')).toBe(`#!/bin/sh\n${line}\n`);
    });

    test('removes libtool archives and keeps the static archives', () => {
        put('lib/libgeotiff.la', `libdir='${DOCKER_PREFIX}/lib'\n`);
        put('lib/libgeotiff.a', 'archive');

        relocate();

        expect(fs.existsSync(upath.join(prefixDir, 'lib/libgeotiff.la'))).toBe(false);
        expect(read('lib/libgeotiff.a')).toBe('archive');
    });

    test('reduces dependency archive paths in CMake files to library names', () => {
        const hostSsl = upath.join(work, 'node_modules/@crossbind/port-openssl-linux/dist/prebuilt', TARGET, 'lib/libssl.a');
        put('lib/cmake/CURL/CURLConfig.cmake', `set(CURL_LIBRARIES_PRIVATE "${OPENSSL_LIB}/libssl.a;${OPENSSL_LIB}/libcrypto.a;dl;${hostSsl}")\n`);

        relocate();

        expect(read('lib/cmake/CURL/CURLConfig.cmake')).toBe('set(CURL_LIBRARIES_PRIVATE "ssl;crypto;dl;ssl")\n');
    });

    // iOS dependencies come out of an xcframework, whose archives sit in a slice directory.
    test('reduces dependency archives outside a lib directory to library names', () => {
        const ssl = upath.join(work, 'ports/openssl/ios/ssl.xcframework/ios-arm64/libssl.a');
        put('lib/cmake/CURL/CURLConfig.cmake', `set(CURL_LIBRARIES_PRIVATE "${ssl};dl")\n`);

        relocate();

        expect(read('lib/cmake/CURL/CURLConfig.cmake')).toBe('set(CURL_LIBRARIES_PRIVATE "ssl;dl")\n');
    });

    // A configure build for WASI links crossbind's runtime stubs through LIBS, which the .pc records.
    test('drops object files of the build tree from pkg-config files', () => {
        const stubs = upath.join(work, 'ports/spatialite/wasi/.crossbind/build/Source-Release/wasi-wasm32-st-release/crossbind-wasi-stubs.o');
        put('lib/pkgconfig/spatialite.pc', `prefix=${DOCKER_PREFIX}\nLibs: -L\${libdir} -lspatialite ${stubs} -lm\n`);

        relocate();

        expect(read('lib/pkgconfig/spatialite.pc')).toBe('prefix=${pcfiledir}/../..\nLibs: -L${libdir} -lspatialite -lm\n');
    });

    test('leaves headers alone: their paths are compiled into the archives anyway', () => {
        put('include/cpl_config.h', `#define GDAL_PREFIX "${DOCKER_PREFIX}"\n`);

        relocate();

        expect(read('include/cpl_config.h')).toBe(`#define GDAL_PREFIX "${DOCKER_PREFIX}"\n`);
    });

    test('is idempotent and leaves files without build paths as they are', () => {
        put('lib/pkgconfig/libzstd.pc', `prefix=${DOCKER_PREFIX}\n`);
        put('lib/pkgconfig/plain.pc', 'prefix=/usr\n');
        put('bin/plain-config', '#!/bin/sh\nprefix=/usr\n');

        relocate();
        relocate();

        expect(read('lib/pkgconfig/libzstd.pc')).toBe('prefix=${pcfiledir}/../..\n');
        expect(read('lib/pkgconfig/plain.pc')).toBe('prefix=/usr\n');
        expect(read('bin/plain-config')).toBe('#!/bin/sh\nprefix=/usr\n');
    });
});

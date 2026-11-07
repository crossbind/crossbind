// Builds @crossbind/bridge-tools in crossbind's pinned web image: SWIG as WebAssembly, from the revision the image's own
// swig is built from, and the headers and predefined macros of the image's em++, so a Mac makes the same bridges.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveLicenseExpression, formatCycloneDxSbom, formatNoticeSections } from '../../../core/crossbind/src/utils/licenseReport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const DIST = path.join(ROOT, 'dist');
const DOWNLOADS = path.join(ROOT, '.downloads');
const swigArchive = (rev) => `https://github.com/crossbind/swig/archive/${rev}.zip`;
const EMBIND_EXCEPTION_REV = 'a93ac710ca7d66b76ccd49850eb048fddd2461e1';
const EMBIND_EXCEPTION =
    'As a special exception, the code this module writes into the files SWIG generates, in this and every earlier version of the ' +
    'module, may be used under the same terms as the SWIG library: without restriction, under terms of your choice.';
// The directories em++ searches in the web image, and where the package keeps each.
const IMAGE_DIRS = [
    [/^\/emsdk\/upstream\/emscripten\/cache\/sysroot\/include(\/.+)?$/, 'emscripten/include'],
    [/^\/emsdk\/upstream\/lib\/clang\/[^/]+\/include$/, 'clang/include'],
];

export function webImage() {
    const digests = JSON.parse(fs.readFileSync(path.join(REPO, 'core/crossbind/src/assets/toolchain-digests.json'), 'utf8'));
    return `ghcr.io/crossbind/web@${digests.images.web.index}`;
}

export function swigPin(dockerfile) {
    const arg = (name) => dockerfile.match(new RegExp(`^ARG ${name}=(\\S+)$`, 'm'))?.[1] ?? '';
    const pin = { rev: arg('SWIG_REV'), sha256: arg('SWIG_SHA256') };
    if (!/^[0-9a-f]{40}$/.test(pin.rev) || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
        throw new Error('crossbind: tooling/docker/base.Dockerfile pins no SWIG_REV and SWIG_SHA256, which bridge-tools builds SWIG from.');
    }
    return pin;
}

export function includeDirsOf(searchList) {
    return searchList
        .trim()
        .split('\n')
        .map((dir) => {
            const known = IMAGE_DIRS.find(([pattern]) => pattern.test(dir));
            if (!known) throw new Error(`crossbind: em++ searches ${dir}, which bridge-tools does not carry.`);
            const [pattern, local] = known;
            return local + (dir.match(pattern)[1] ?? '');
        });
}

export function componentRows({ swig, pcre2, versions, licenseText = () => undefined }) {
    return [
        {
            name: 'crossbind',
            license: 'MIT',
            sourceUrl: 'https://github.com/crossbind/crossbind',
            licenseText: licenseText('crossbind-LICENSE'),
            licenseNotes: 'index.js, which runs SWIG and names the headers for clang.',
        },
        {
            name: 'swig',
            license: 'GPL-3.0-or-later',
            nativeVersion: swig.rev,
            sourceUrl: swigArchive(swig.rev),
            sha256: swig.sha256,
            licenseText: licenseText('swig-LICENSE', 'swig-LICENSE-GPL', 'swig-LICENSE-UNIVERSITIES', 'swig-COPYRIGHT'),
            licenseNotes:
                "crossbind's fork of SWIG, built as WebAssembly by this package's scripts, whose source is the archive above. The bridges " +
                `it writes are not under the GPL: the source of its embind module, from revision ${EMBIND_EXCEPTION_REV} on, says "${EMBIND_EXCEPTION}"`,
        },
        {
            name: 'swig-library',
            license: 'LicenseRef-SWIG-Library',
            nativeVersion: swig.rev,
            licenseNotes: "SWIG's Lib, dist/swig/share, under the terms SWIG's LICENSE gives the SWIG library: without restriction.",
        },
        {
            name: 'pcre2',
            license: 'BSD-3-Clause',
            nativeVersion: pcre2.version,
            sourceUrl: pcre2.url,
            sha256: pcre2.sha256,
            licenseText: licenseText('pcre2-LICENCE.md'),
            licenseNotes:
                'BSD-3-Clause with the PCRE2 exception, which the SPDX list crossbind checks against lacks; the plain license is the stricter one.',
        },
        {
            name: 'emscripten',
            license: 'MIT OR NCSA',
            nativeVersion: versions.emscripten,
            sourceUrl: 'https://github.com/emscripten-core/emscripten',
            licenseText: licenseText('emscripten-LICENSE'),
            licenseNotes: "emscripten's headers, dist/emscripten/include, as the web image has them, and its runtime, compiled into dist/swig.",
        },
        {
            name: 'emscripten-third-party-headers',
            license: 'LicenseRef-Emscripten-Third-Party-Headers',
            nativeVersion: versions.emscripten,
            licenseNotes:
                'Headers of other projects that emscripten carries in dist/emscripten/include, each under the notice in its file: ' +
                "SDL 1.x and GLFW (Zlib); Mesa's gl.h, freeglut, mimalloc and compat/arm_neon.h (MIT); the Khronos GL, GLES, EGL and KHR " +
                "headers (the Khronos Group's MIT-style license, Apache-2.0 for the three GLES platform headers); SGI's glu.h (SGI Free " +
                'Software License B 2.0); the X11 headers (the permission notices of The Open Group, SGI and Keith Packard); wasi/api.h ' +
                '(CC0-1.0). The headers without a notice of their own come with emscripten under its license.',
        },
        {
            name: 'musl',
            license: 'MIT',
            nativeVersion: versions.musl,
            licenseText: licenseText('musl-COPYRIGHT'),
            licenseNotes: "musl's headers, among emscripten's, and its C library, compiled into dist/swig/swig.wasm.",
        },
        {
            name: 'llvm',
            license: 'Apache-2.0 WITH LLVM-exception',
            nativeVersion: versions.clang,
            licenseText: licenseText('llvm-LICENSE.TXT'),
            licenseNotes:
                "libc++'s headers, among emscripten's, and its code, with libc++abi's and compiler-rt's, compiled into dist/swig/swig.wasm; " +
                "clang's own headers, dist/clang/include.",
        },
    ];
}

const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function fetchPinned(url, sha256, file) {
    if (fs.existsSync(file) && sha256Of(fs.readFileSync(file)) === sha256) return;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`crossbind: ${url} answered ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256Of(bytes);
    if (actual !== sha256) throw new Error(`crossbind: ${url} has sha256 ${actual}, not the pinned ${sha256}.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
}

async function main() {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
    const swig = swigPin(read(path.join(REPO, 'tooling/docker/base.Dockerfile')));
    const { pcre2 } = JSON.parse(read(path.join(ROOT, 'sources.json')));
    const image = webImage();

    await fetchPinned(swigArchive(swig.rev), swig.sha256, path.join(DOWNLOADS, 'swig.zip'));
    await fetchPinned(pcre2.url, pcre2.sha256, path.join(DOWNLOADS, 'pcre2.tar.gz'));
    execFileSync(
        'docker',
        [
            'run',
            '--rm',
            '--security-opt',
            'no-new-privileges=true',
            '--user',
            '0',
            '-v',
            `${ROOT}:/work`,
            '-e',
            `SWIG_REV=${swig.rev}`,
            '-e',
            `PCRE2_VERSION=${pcre2.version}`,
            '-e',
            `HOST_UID=${process.getuid()}`,
            '-e',
            `HOST_GID=${process.getgid()}`,
            image,
            'bash',
            '/work/scripts/build-in-image.sh',
        ],
        { stdio: 'inherit' },
    );

    const versions = JSON.parse(read(path.join(DIST, 'versions.json')));
    const [swigVersion] = fs.readdirSync(path.join(DIST, 'swig/share/swig'));
    const manifest = {
        swig: { version: swigVersion, rev: swig.rev, js: 'swig/swig.cjs', wasm: 'swig/swig.wasm', lib: `swig/share/swig/${swigVersion}` },
        emscripten: versions.emscripten,
        pcre2: pcre2.version,
        image,
        predefined: 'predefined.h',
        includeDirs: includeDirsOf(read(path.join(DIST, 'include-order.txt'))),
    };
    fs.writeFileSync(path.join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    fs.rmSync(path.join(DIST, 'versions.json'));
    fs.rmSync(path.join(DIST, 'include-order.txt'));

    fs.copyFileSync(path.join(REPO, 'LICENSE'), path.join(DIST, 'licenses', 'crossbind-LICENSE'));
    const licenseText = (...files) => files.map((file) => read(path.join(DIST, 'licenses', file))).join('\n\n');
    const rows = componentRows({ swig, pcre2, versions, licenseText });
    const license = deriveLicenseExpression(rows);
    if (license !== pkg.license) throw new Error(`crossbind: bridge-tools carries ${license}, but its package.json says ${pkg.license}.`);
    fs.writeFileSync(
        path.join(ROOT, 'LICENSE'),
        [
            `# ${pkg.name}`,
            '',
            'GENERATED by scripts/build.mjs - do not edit.',
            '',
            `The package's license is ${license}, of these components:`,
            '',
            formatNoticeSections(rows).join('\n\n'),
            '',
        ].join('\n'),
    );
    fs.writeFileSync(path.join(ROOT, 'sbom.cdx.json'), formatCycloneDxSbom(rows, { name: pkg.name, version: pkg.version }));
    console.log(`crossbind: built ${pkg.name} with SWIG ${swigVersion} (${swig.rev.slice(0, 9)}) and emscripten ${versions.emscripten}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

#!/usr/bin/env node
// Smoke test for the crossbind image family, one run per image AND architecture - a toolchain can
// be missing on exactly one leaf of a multi-arch index and nothing else would notice.
//
//   node scripts/smoke-images.js                 # every image built locally
//   node scripts/smoke-images.js web:amd64       # just one
//   node scripts/smoke-images.js --published     # what the registry actually serves
//
// Asserts what the images promise: the pinned toolchain versions, a compile that actually runs,
// the caches a container running as the host uid must be able to write, and the two things that
// must NOT be there - rust-src and RUSTC_BOOTSTRAP.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// The version lives in one place - the Dockerfile that builds the sysroot - because a copy here
// would agree with it right up until someone bumps one and not the other.
const RUST_VERSION = fs
    .readFileSync(new URL('../tooling/docker/rust-sysroot.Dockerfile', import.meta.url), 'utf8')
    .match(/^ARG RUST_VERSION=(.+)$/m)?.[1]
    ?.trim();
if (!RUST_VERSION) throw new Error('cannot read ARG RUST_VERSION from tooling/docker/rust-sysroot.Dockerfile');
const WEB_DOCKERFILE = fs.readFileSync(new URL('../tooling/docker/web.Dockerfile', import.meta.url), 'utf8');
const EMSDK_VERSION = WEB_DOCKERFILE.match(/^ARG EMSDK_VERSION=(.+)$/m)?.[1]?.trim();
const WASI_SDK_VERSION = WEB_DOCKERFILE.match(/^ARG WASI_SDK_VERSION=(.+)$/m)?.[1]?.trim();
if (!EMSDK_VERSION || !WASI_SDK_VERSION) throw new Error('cannot read web toolchain versions from tooling/docker/web.Dockerfile');
const NODE_VERSION = fs.readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();

// Local builds carry one tag per architecture, because `docker build --load` cannot produce a
// multi-arch index; a published image is a single index that resolves per platform on pull.
const PUBLISHED = process.argv.includes('--published');
const VERSION = fs.readFileSync(new URL('../tooling/docker/VERSION', import.meta.url), 'utf8').trim();
const refFor = (name, local) => (PUBLISHED ? `ghcr.io/crossbind/${name}:${VERSION}` : local);

const IMAGES = [
    { name: 'base', ref: refFor('base', 'crossbind/base:dev'), arch: 'arm64' },
    { name: 'base', ref: refFor('base', 'crossbind/base:dev-amd64'), arch: 'amd64' },
    { name: 'web', ref: refFor('web', 'crossbind/web:dev'), arch: 'arm64' },
    { name: 'web', ref: refFor('web', 'crossbind/web:dev-amd64'), arch: 'amd64' },
    { name: 'android', ref: refFor('android', 'crossbind/android:dev'), arch: 'amd64' },
];

// A container that cannot write these is a container that cannot build: crossbind runs docker with
// --user <host uid>, which has no passwd entry and therefore no home of its own.
const HOST_UID = '1000:1000';

const BASE_SCRIPT = `set -e
node -e 'process.exit(process.versions.node === "${NODE_VERSION}" ? 0 : 1)'
echo "node $(node -v)"
rustc -vV | sed -n 's/^release: //p' | grep -qx '${RUST_VERSION}'
echo "rustc $(rustc -vV | sed -n 's/^release: //p') cargo $(cargo --version | cut -d' ' -f2)"
swig -version | sed -n 's/.*SWIG Version //p' | head -1 | sed 's/^/swig /'
cmake --version | head -1
test -f /opt/licenses/README.md && echo "licenses $(ls /opt/licenses | wc -l | tr -d ' ') entries + README"
test ! -d /usr/local/rustup/toolchains/*/lib/rustlib/src && echo "rust-src absent"
touch "$CARGO_HOME/.probe" && rm "$CARGO_HOME/.probe" && echo "cargo home writable"
`;

const WEB_SCRIPT = `${BASE_SCRIPT}
emcc --version | head -1 | grep -F ' ${EMSDK_VERSION} '
echo "emscripten ${EMSDK_VERSION}"
test -x /opt/wasi-sdk/bin/clang && echo "wasi-sdk present"
head -1 /opt/wasi-sdk/VERSION | grep -E '^${WASI_SDK_VERSION}(\\.0)?([+ -]|$)'
echo "wasi-sdk $(head -1 /opt/wasi-sdk/VERSION)"
node -e 'const m=require("/opt/crossbind/rust/${RUST_VERSION}/manifest.json");
  if (m.rustc !== "${RUST_VERSION}") { console.error("sysroot rustc " + m.rustc); process.exit(1) }
  if (m.emsdk !== "${EMSDK_VERSION}") { console.error("sysroot emsdk " + m.emsdk); process.exit(1) }
  for (const v of ["st","mt"]) if (!m.variants[v]) { console.error("missing variant " + v); process.exit(1) }
  console.log("sysroot " + m.rustc + " emsdk=" + m.emsdk + " " + m.target + " panic=" + m.panic)'
test -f /opt/crossbind/rust/${RUST_VERSION}/mt/lib/rustlib/wasm32-unknown-emscripten/lib/libstd-*.rlib && echo "mt std present"
touch "$EM_CACHE/.probe" && rm "$EM_CACHE/.probe" && echo "em cache writable"
cd /tmp && printf '#include <stdio.h>\\nint main(){printf("ok\\\\n");return 0;}\\n' > s.c
emcc s.c -o s.js && node s.js | grep -qx ok && echo "emcc compile+run ok"
printf '#include <emscripten/bind.h>\\n#include <string>\\nint pick(int){return 1;} int pick(std::string){return 2;}\\nEMSCRIPTEN_BINDINGS(smoke){emscripten::function("pick", emscripten::select_overload<int(int)>(&pick)); emscripten::function("pick", emscripten::select_overload<int(std::string)>(&pick));}\\n' > overload.cpp
em++ overload.cpp -lembind -sMODULARIZE=1 -sEXPORT_ES6=1 -o overload.mjs
printf 'import createModule from "./overload.mjs"; const m=await createModule(); if(m.pick(7)!==1||m.pick("x")!==2) process.exit(1);\\n' > overload-check.mjs
node overload-check.mjs && echo "embind type overload compile+run ok"
`;

const ANDROID_SCRIPT = `${BASE_SCRIPT}
test -x "$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android33-clang" && echo "ndk arm64 clang present"
test -x "$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android33-clang" && echo "ndk x86_64 clang present"
rustup target list --installed | grep -qx aarch64-linux-android
rustup target list --installed | grep -qx x86_64-linux-android
cd /tmp && printf 'extern "C" int crossbind_probe(){return 7;}\n' > android.cpp
for target in aarch64-linux-android x86_64-linux-android; do
  "$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin/\${target}33-clang++" -c android.cpp -o "\${target}.o"
  printf 'pub extern "C" fn crossbind_rust_probe()->i32{7}\n' > android.rs
  rustc --target "\${target}" --crate-type staticlib -C panic=abort android.rs -o "lib\${target}.a"
  test -s "\${target}.o" && test -s "lib\${target}.a"
done
echo "android C++ and Rust targets compile"
`;

const SCRIPTS = { base: BASE_SCRIPT, web: WEB_SCRIPT, android: ANDROID_SCRIPT };

function inspect(ref, format) {
    return execFileSync('docker', ['image', 'inspect', ref, '--format', format], { encoding: 'utf8' }).trim();
}

function smoke({ name, ref, arch }) {
    // A published ref is an index: inspect reads the local store, so the wanted platform has to be
    // pulled first - and pulling it is itself part of what this checks.
    if (PUBLISHED) {
        execFileSync('docker', ['pull', '--platform', `linux/${arch}`, ref], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
    const actual = inspect(ref, '{{.Architecture}}');
    if (actual !== arch) throw new Error(`${ref} is ${actual}, expected ${arch}`);
    const env = inspect(ref, '{{json .Config.Env}}');
    if (env.includes('RUSTC_BOOTSTRAP')) throw new Error(`${ref} carries RUSTC_BOOTSTRAP in Config.Env`);
    const configuredUser = inspect(ref, '{{.Config.User}}');
    if (configuredUser !== '10001:10001') throw new Error(`${ref} defaults to ${configuredUser || 'root'}, expected 10001:10001`);

    const out = execFileSync(
        'docker',
        [
            'run',
            '--rm',
            '--platform',
            `linux/${arch}`,
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges=true',
            '--user',
            HOST_UID,
            ref,
            'sh',
            '-c',
            SCRIPTS[name],
        ],
        {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return out.trim().split('\n');
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selected = wanted.length ? IMAGES.filter(({ name, arch }) => wanted.some((w) => w === name || w === `${name}:${arch}`)) : IMAGES;
if (!selected.length) {
    console.error(`smoke-images: nothing matches ${wanted.join(', ')}`);
    process.exit(1);
}

let failed = 0;
for (const image of selected) {
    const label = `${image.name}:${image.arch}`;
    try {
        const lines = smoke(image);
        console.log(`PASS ${label}`);
        lines.forEach((line) => console.log(`     ${line}`));
    } catch (e) {
        failed += 1;
        console.error(`FAIL ${label}`);
        console.error(`     ${(e.stderr?.toString() || e.message).trim().split('\n').slice(-6).join('\n     ')}`);
    }
}
console.log(`\nsmoke-images: ${selected.length - failed}/${selected.length} passed`);
process.exit(failed ? 1 : 0);

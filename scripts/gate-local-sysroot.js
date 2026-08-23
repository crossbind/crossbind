#!/usr/bin/env node
// Release gate (ADR rev 6.6): the sysroot artifact a host build downloads is actually consumable.
//
//   node scripts/gate-local-sysroot.js --tar tooling/docker/dist/crossbind-rust-sysroot-1.97.1.tar
//   node scripts/gate-local-sysroot.js            # the pinned, published artifact
//
// The containerized path gets the sysroots as an image layer, and the image build probes them. This
// is the OTHER channel: a tarball on a developer's machine. Everything here is a way that channel
// can be broken while the image stays perfect - a tree that only works at the path it was unpacked
// to, a manifest that does not match the compiler on PATH, a build that quietly needs the network,
// two builds racing into the same cache directory.
//
// It drives the CLI's own loader rather than reimplementing it, so what passes here is what a user
// gets. Checks that genuinely need a published artifact SKIP rather than pass when given a tarball.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => pathToFileURL(path.join(ROOT, 'core/crossbind/src/utils', f)).href;
const { assertManifest, hostRustc, sysrootPath } = await import(src('rustSysroot.js'));
const ensureRustSysroot = (await import(src('rustSysroot.js'))).default;
const PIN = (await import(src('rustSysrootPin.js'))).default;
const { cargoBuildInvocation } = await import(src('rustMt.js'));

const arg = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const TAR = arg('--tar');
// The publish workflow gates the archive it has just uploaded, before anyone pins it: that is the
// only moment a bad artifact can still be caught without a release going out behind it.
const SOURCE = arg('--url') && arg('--sha256')
    ? { url: arg('--url'), sha256: arg('--sha256') }
    : PIN;
const SEP = String.fromCharCode(0x1f);

const results = [];
const ok = (msg) => { results.push(['ok', msg]); console.log(`  ok    ${msg}`); };
const skip = (msg) => { results.push(['skip', msg]); console.log(`  skip  ${msg}`); };
const fail = (msg, detail = '') => {
    results.push(['fail', msg]);
    console.error(`  FAIL  ${msg}`);
    if (detail) detail.trim().split('\n').slice(-5).forEach((l) => console.error(`        ${l}`));
};

function extract(tar, into) {
    fs.mkdirSync(into, { recursive: true });
    const r = spawnSync('tar', ['-xf', tar, '-C', into], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || `tar exited ${r.status}`);
    const versions = path.join(into, 'opt', 'crossbind', 'rust');
    const found = fs.readdirSync(versions).map((v) => path.join(versions, v))
        .find((d) => fs.existsSync(path.join(d, 'manifest.json')));
    if (!found) throw new Error('the archive carries no opt/crossbind/rust/<version>/manifest.json');
    return found;
}

// A probe with a build script and a proc-macro-shaped host unit: when --target is passed, cargo
// does NOT apply RUSTFLAGS to host units, so these must compile against the HOST sysroot while the
// wasm units use the shipped one. A tree that got this wrong would fail only here.
function writeProbe(dir) {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Cargo.toml'),
        '[package]\nname="probe"\nversion="0.0.0"\nedition="2021"\n'
        + '[lib]\ncrate-type=["staticlib"]\n[profile.release]\npanic="abort"\n[workspace]\n');
    fs.writeFileSync(path.join(dir, 'build.rs'), 'fn main(){ println!("cargo:rerun-if-changed=build.rs"); }\n');
    fs.writeFileSync(path.join(dir, 'src/lib.rs'),
        'pub fn f() -> usize { vec![1u32,2,3].iter().sum::<u32>() as usize }\n');
    // --frozen means "the lock is already right"; without one every build below would fail on the
    // lock rather than on what it is meant to test. The probe has no dependencies, so this needs
    // no network either.
    const lock = spawnSync('cargo', ['generate-lockfile', '--offline', '--manifest-path', path.join(dir, 'Cargo.toml')], {
        encoding: 'utf8', env: { ...process.env, CARGO_HOME: path.join(dir, '.cargo') },
    });
    if (lock.status !== 0) throw new Error(`cargo generate-lockfile: ${lock.stderr || lock.status}`);
}

// The invocation comes from the CLI's own builder, not from a copy of it here: this gate is only
// worth anything if it runs what a user runs. That also settles what "debug x release" means -
// crossbind compiles cargo units with --release for every app buildType, because the shipped std
// is panic=abort and cargo's dev profile would ask for panic_unwind.
function build({ tree, variant, buildType, dir }) {
    const target = { platform: 'wasm', arch: 'wasm32', runtime: variant, buildType };
    const { args, rustflags, panic, allowUnstable } = cargoBuildInvocation({
        target,
        triple: 'wasm32-unknown-emscripten',
        targetDir: path.join(dir, `t-${variant}-${buildType}`),
        manifestPath: path.join(dir, 'Cargo.toml'),
        sysroot: tree,
    });
    if (allowUnstable) throw new Error(`the ${variant} sysroot path asked for unstable flags`);
    if (args.includes('+nightly') || args.some((a) => String(a).includes('build-std'))) {
        throw new Error(`the ${variant} sysroot path still reaches for nightly: ${args.join(' ')}`);
    }
    return spawnSync('cargo', [...args, '--offline', '--frozen'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            CARGO_HOME: path.join(dir, '.cargo'),
            CARGO_ENCODED_RUSTFLAGS: rustflags.join(SEP),
            ...(panic ? { CARGO_PROFILE_RELEASE_PANIC: panic } : {}),
            RUSTC_BOOTSTRAP: '-1', // what runCargo sets: no unstable, on any channel
        },
    });
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gate-'));
console.log(`gate-local-sysroot: ${os.platform()}/${os.arch()}, rustc ${hostRustc().version}\n`);

let tree;
try {
    if (TAR) {
        // "relocatable" is the whole point of extracting somewhere with a space in it: an rlib tree
        // that baked its own path in would work in CI and break on a real machine.
        tree = extract(path.resolve(TAR), path.join(work, 'with space'));
            ok('extracted and read back from a path containing a space');
    } else if (SOURCE) {
        tree = await ensureRustSysroot({ url: SOURCE.url, sha256: SOURCE.sha256, root: path.join(work, 'cache') });
        ok('downloaded and verified the pinned artifact through the CLI loader');
    } else {
        console.log('  skip  no --tar, --url or pinned artifact - nothing to gate');
        process.exit(0);
    }
} catch (e) {
    fail('obtaining the artifact', e.message);
    process.exit(1);
}

try {
    assertManifest(JSON.parse(fs.readFileSync(path.join(tree, 'manifest.json'), 'utf8')));
    ok('the manifest matches the rustc on PATH');
} catch (e) {
    fail('manifest vs host rustc', e.message);
}

const probe = path.join(work, 'probe');
writeProbe(probe);
for (const variant of ['st', 'mt']) {
    for (const buildType of ['debug', 'release']) {
        try {
            const r = build({ tree, variant, buildType, dir: probe });
            if (r.status === 0) ok(`${variant} × ${buildType}: compiles offline against the shipped sysroot, no nightly`);
            else fail(`${variant} × ${buildType}`, r.stderr || `cargo exited ${r.status}`);
        } catch (e) { fail(`${variant} × ${buildType}`, e.message); }
    }
}

// The build script above had to compile for the host to get this far; say so explicitly, because it
// is the assumption the whole channel rests on.
if (fs.existsSync(path.join(probe, 't-mt-release'))) {
    ok('the build script compiled for the host while wasm units used the shipped sysroot');
}

// A second tree at a different root must serve the same builds: proves nothing was path-baked.
if (TAR) {
    try {
        const moved = extract(path.resolve(TAR), path.join(work, 'other-root'));
        const r = build({ tree: moved, variant: 'mt', buildType: 'release', dir: probe });
        if (r.status === 0) ok('the same artifact works from a second, unrelated root');
        else fail('relocated tree', r.stderr);
    } catch (e) { fail('relocating the tree', e.message); }
}

// Concurrency is a property of the loader, not the tarball: N builds starting at once must not
// tear the cache. Only a real URL exercises the download+rename path the loader locks around.
if (!TAR && SOURCE) {
    const root = path.join(work, 'race');
    const runs = await Promise.allSettled(Array.from({ length: 4 }, () => ensureRustSysroot({ url: SOURCE.url, sha256: SOURCE.sha256, root })));
    const bad = runs.filter((r) => r.status === 'rejected');
    if (bad.length) fail('concurrent extraction', bad.map((b) => b.reason?.message).join('\n'));
    else if (new Set(runs.map((r) => r.value)).size !== 1) fail('concurrent extraction returned different directories');
    else ok('four concurrent loads share one verified directory');
} else {
    skip('concurrent download/extraction (needs a published artifact)');
}

fs.rmSync(work, { recursive: true, force: true });
const failed = results.filter(([s]) => s === 'fail').length;
const skipped = results.filter(([s]) => s === 'skip').length;
console.log(`\ngate-local-sysroot: ${results.length - failed - skipped}/${results.length - skipped} passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);

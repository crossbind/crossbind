import { spawnSync } from 'node:child_process';
import path from 'node:path';

// One argv per flag: runCargo joins these with cargo's 0x1F separator, so a flag must not
// contain a space of its own.
const MT_RUSTFLAGS = ['-Ctarget-feature=+atomics,+bulk-memory,+mutable-globals'];

// mt (shared-memory) wasm needs every Rust object built with the atomics/bulk-memory features,
// std included - and rustup ships only a featureless std. The nightly-only -Zbuild-std rebuild
// below is the same recipe wasm-bindgen-rayon uses; probing first turns a cryptic wasm-ld error
// into an actionable install instruction. Shared by every cargo entry point (app-local super
// crate and cargo-type packages).
export function isMtWasm(target) {
    return target.platform === 'wasm' && target.runtime === 'mt';
}

export function assertMtRustToolchain() {
    const probe = spawnSync('rustup', ['component', 'list', '--toolchain', 'nightly', '--installed'], { encoding: 'utf8' });
    if (probe.status !== 0 || !String(probe.stdout ?? '').includes('rust-src')) {
        throw new Error(
            "crossbind: Rust on the wasm 'mt' runtime needs the Rust std rebuilt with "
            + 'atomics (nightly -Zbuild-std). Run `rustup toolchain install nightly '
            + "--component rust-src` and rebuild, or build with runtime 'st'.",
        );
    }
}

// st and mt share a cargo triple, so they must not share a target dir: cargo would happily
// serve featureless objects to a shared-memory link (or atomics objects to an st one).
export function cargoTargetDirFor(baseDir, target) {
    return `${baseDir}/${isMtWasm(target) ? 'target-mt' : 'target'}`;
}

// The wasm sysroots the image ships, each a COMPLETE sysroot (see web.Dockerfile): --sysroot is
// global, so build scripts and proc-macros compiled for the host resolve there too. `current`
// points at whatever version that image pinned, so the CLI carries no version of its own.
const CONTAINER_SYSROOT = '/opt/crossbind/rust/current';

export function cargoBuildInvocation({
    target, triple, targetDir, manifestPath, sysroot = false,
}) {
    const isMt = isMtWasm(target);
    // With a prebuilt sysroot there is nothing to rebuild and nothing unstable to ask for: stable
    // rustc links the std that was compiled with the same features. Without one - no pinned
    // artifact, or a host on a different rustc - mt still rebuilds std the nightly way.
    const buildStd = isMt && !sysroot;
    const args = [
        ...(buildStd ? ['+nightly'] : []),
        'build', '--release', '--target', triple,
        ...(buildStd ? ['-Zbuild-std=std,panic_abort'] : []),
        '--target-dir', targetDir, '--manifest-path', manifestPath,
    ];
    // Flags travel as data, not as an environment patch: cargo ignores RUSTFLAGS outright when
    // CARGO_ENCODED_RUSTFLAGS is set, so inheriting the caller's environment here used to let a
    // developer who has that variable exported silently link a featureless std into an mt module.
    // panic is the other half of the same contract - the std being linked is built with abort.
    // `true` is the image tree at a path only the container has; a string is a downloaded
    // artifact on this machine (RUNNER=LOCAL). Same layout either way: <root>/<variant>.
    const variant = isMt ? 'mt' : 'st';
    let wasmSysroot = null;
    if (sysroot && target.platform === 'wasm') {
        wasmSysroot = sysroot === true ? `${CONTAINER_SYSROOT}/${variant}` : path.join(sysroot, variant);
    }
    return {
        args,
        rustflags: [
            ...(wasmSysroot ? ['--sysroot', wasmSysroot] : []),
            ...(isMt ? MT_RUSTFLAGS : []),
        ],
        panic: target.platform === 'wasm' ? 'abort' : undefined,
        // Only the nightly build-std rebuild needs unstable flags; where a sysroot answers, stable
        // is enough and the pin stays on.
        allowUnstable: buildStd,
        isMt,
    };
}

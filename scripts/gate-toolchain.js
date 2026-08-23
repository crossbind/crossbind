#!/usr/bin/env node
// Release gate: the toolchain in the image cannot be talked out of being stable.
//
//   node scripts/gate-toolchain.js                  # the locally built web image
//   node scripts/gate-toolchain.js --published      # what the registry serves
//   node scripts/gate-toolchain.js --arch amd64
//
// smoke-images.js asserts the image HAS what it promises. This asserts what it must REFUSE, and it
// runs against the real Linux cargo inside the image rather than a mocked one, because every
// mechanism here - config discovery, flag precedence, RUSTC_BOOTSTRAP - is cargo's behaviour, not
// ours. A unit test can only pin what we pass; this pins what cargo does with it.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const RUST_VERSION = '1.97.1';
const PUBLISHED = process.argv.includes('--published');
const archIndex = process.argv.indexOf('--arch');
const ARCH = archIndex !== -1 ? process.argv[archIndex + 1] : 'arm64';
const VERSION = fs.readFileSync(new URL('../tooling/docker/VERSION', import.meta.url), 'utf8').trim();
// The release is built and gated under a staging tag, then promoted; --tag points the gate at it.
const TAG = (process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : null) || VERSION;
const REF = PUBLISHED ? `ghcr.io/crossbind/web:${TAG}` : `crossbind/web:dev${ARCH === 'amd64' ? '-amd64' : ''}`;
const HOST_UID = '1000:1000';

// Cargo splits this on 0x1F, one argv per flag - the same separator runCargo uses.
const SEP = "$(printf '\\037')";

// A crate that asks for a nightly feature: stable rustc must refuse it with E0554 on both shipped
// sysroots. If a sysroot ever smuggled a nightly rustc in, this is what would notice.
const FEATURE_REJECTION = `
mkdir -p /tmp/feat/src && cd /tmp/feat
printf '[package]\\nname="feat"\\nversion="0.0.0"\\nedition="2021"\\n[lib]\\ncrate-type=["rlib"]\\n[workspace]\\n' > Cargo.toml
printf '#![feature(never_type)]\\npub fn f() {}\\n' > src/lib.rs
for variant in st mt; do
  if CARGO_HOME=/tmp/feat/.cargo \\
     CARGO_ENCODED_RUSTFLAGS="--sysroot${SEP}/opt/crossbind/rust/current/\$variant" \\
     cargo build --release --target wasm32-unknown-emscripten --target-dir "/tmp/feat/t-\$variant" >/dev/null 2>/tmp/feat/err; then
    echo "FAIL  #![feature] was accepted on the \$variant sysroot"; exit 1
  fi
  grep -q 'E0554' /tmp/feat/err || { echo "FAIL  \$variant rejected it, but not with E0554:"; tail -3 /tmp/feat/err; exit 1; }
  echo "ok    #![feature] refused on the \$variant sysroot (E0554)"
done
`;

// (a) A hostile [build] rustflags next to the crate must not reach rustc when we pass our own:
// cargo ignores the config channel entirely once CARGO_ENCODED_RUSTFLAGS is set. Run from INSIDE
// the project so the hostile config is discoverable - the point is precedence, not discovery.
const FLAG_PRECEDENCE = `
mkdir -p /tmp/prec/src /tmp/prec/.cargo && cd /tmp/prec
printf '[package]\\nname="prec"\\nversion="0.0.0"\\nedition="2021"\\n[lib]\\ncrate-type=["rlib"]\\n[workspace]\\n' > Cargo.toml
printf '[build]\\nrustflags = ["--cfg", "hostile"]\\n' > .cargo/config.toml
printf '#[cfg(hostile)]\\ncompile_error!("the config rustflags reached rustc");\\n#[cfg(not(ours))]\\ncompile_error!("our rustflags did not reach rustc");\\npub fn f() {}\\n' > src/lib.rs
CARGO_HOME=/tmp/prec/.cargohome CARGO_ENCODED_RUSTFLAGS="--cfg${SEP}ours" \\
  cargo build --release --target-dir /tmp/prec/t >/dev/null 2>/tmp/prec/err \\
  || { echo "FAIL  flag precedence:"; tail -4 /tmp/prec/err; exit 1; }
echo "ok    our rustflags win over a hostile [build] rustflags"
`;

// (b1) A hostile config next to the crate is invisible when cargo runs from a neutral directory:
// cargo walks up from the CWD, never from --manifest-path. This is the leg crossbind closes by
// running out of a directory that belongs to nobody.
const PROJECT_CONFIG_NOT_DISCOVERED = `
mkdir -p /tmp/hostile/src /tmp/hostile/.cargo /tmp/neutral && cd /tmp/neutral
printf '[package]\\nname="hostile"\\nversion="0.0.0"\\nedition="2021"\\n[lib]\\ncrate-type=["rlib"]\\n[workspace]\\n' > /tmp/hostile/Cargo.toml
printf '#![feature(never_type)]\\npub fn f() {}\\n' > /tmp/hostile/src/lib.rs
printf '[env]\\nRUSTC_BOOTSTRAP = { value = "1", force = true }\\n' > /tmp/hostile/.cargo/config.toml
if CARGO_HOME=/tmp/hostile/.cargohome cargo build --release --manifest-path /tmp/hostile/Cargo.toml \\
     --target-dir /tmp/hostile/t >/dev/null 2>/tmp/hostile/err; then
  echo "FAIL  a config beside the crate opened nightly from a neutral cwd"; exit 1
fi
grep -q 'E0554' /tmp/hostile/err || { echo "FAIL  it failed, but not with E0554:"; tail -3 /tmp/hostile/err; exit 1; }
echo "ok    a config beside the crate is not discovered from a neutral cwd (E0554)"
`;

// (b2) The CARGO_HOME leg is different in kind, and pinning that difference is the point: cargo
// reads $CARGO_HOME/config.toml no matter where it runs, so [env] force=true there DOES turn the
// compiler nightly. Crossbind cannot close this by choosing a cwd - it closes it by owning the
// directory and refusing to build if any config appears in it (assertCleanConfigChain). This check
// keeps the danger honest: if cargo ever stopped applying it, the CLI guard would be dead code and
// nobody would notice.
const CARGO_HOME_CONFIG_IS_LIVE = `
mkdir -p /tmp/planted /tmp/sem2/src /tmp/neutral2 && cd /tmp/neutral2
printf '[package]\\nname="planted"\\nversion="0.0.0"\\nedition="2021"\\n[lib]\\ncrate-type=["rlib"]\\n[workspace]\\n' > /tmp/sem2/Cargo.toml
printf '#![feature(never_type)]\\npub fn f() {}\\n' > /tmp/sem2/src/lib.rs
printf '[env]\\nRUSTC_BOOTSTRAP = { value = "1", force = true }\\n' > /tmp/planted/config.toml
if ! CARGO_HOME=/tmp/planted cargo build --release --manifest-path /tmp/sem2/Cargo.toml \\
      --target-dir /tmp/sem2/t >/dev/null 2>/tmp/sem2/err; then
  echo "NOTE  cargo no longer applies [env] from CARGO_HOME/config.toml - the CLI guard may be obsolete"
  tail -3 /tmp/sem2/err; exit 1
fi
echo "ok    CARGO_HOME/config.toml still opens nightly - the CLI guard that refuses one is load-bearing"
`;

// (c) What RUSTC_BOOTSTRAP actually means, probed rather than assumed. -1 is the value crossbind
// sets, and it has to close nightly on EVERY channel; the crate-name forms are the ones a
// dependency could try to exploit.
const BOOTSTRAP_SEMANTICS = `
mkdir -p /tmp/sem/src && cd /tmp/sem
printf '[package]\\nname="probe"\\nversion="0.0.0"\\nedition="2021"\\n[lib]\\ncrate-type=["rlib"]\\n[workspace]\\n' > Cargo.toml
printf '#![feature(never_type)]\\npub fn f() {}\\n' > src/lib.rs
probe() { # $1 = label, $2 = expectation (open|closed); RUSTC_BOOTSTRAP already exported or unset
  if cargo build --release --target-dir "/tmp/sem/t-\$1" >/dev/null 2>/tmp/sem/err; then got=open; else got=closed; fi
  if [ "\$got" != "\$2" ]; then echo "FAIL  RUSTC_BOOTSTRAP \$1: expected \$2, got \$got"; tail -3 /tmp/sem/err; exit 1; fi
  if [ "\$got" = closed ] && ! grep -q 'E0554' /tmp/sem/err; then echo "FAIL  \$1 closed without E0554"; exit 1; fi
  echo "ok    RUSTC_BOOTSTRAP \$1 -> \$got"
}
export CARGO_HOME=/tmp/sem/.cargo
unset RUSTC_BOOTSTRAP; probe unset closed
export RUSTC_BOOTSTRAP=''; probe empty closed
export RUSTC_BOOTSTRAP=0; probe zero closed
export RUSTC_BOOTSTRAP=-1; probe minus-one closed
export RUSTC_BOOTSTRAP=notprobe; probe other-crate closed
export RUSTC_BOOTSTRAP=1; probe one open
export RUSTC_BOOTSTRAP=probe; probe crate-name open
export RUSTC_BOOTSTRAP=probe,foo; probe crate-list open
`;

const CHECKS = [
    ['#![feature] rejection', FEATURE_REJECTION],
    ['rustflags precedence', FLAG_PRECEDENCE],
    ['project config not discovered', PROJECT_CONFIG_NOT_DISCOVERED],
    ['CARGO_HOME config is load-bearing', CARGO_HOME_CONFIG_IS_LIVE],
    ['RUSTC_BOOTSTRAP semantics', BOOTSTRAP_SEMANTICS],
];

if (PUBLISHED) {
    execFileSync('docker', ['pull', '--platform', `linux/${ARCH}`, REF], { stdio: ['ignore', 'ignore', 'pipe'] });
}
console.log(`gate-toolchain: ${REF} (linux/${ARCH}), rustc ${RUST_VERSION}\n`);

let failed = 0;
for (const [name, script] of CHECKS) {
    try {
        const out = execFileSync('docker', [
            'run', '--rm', '--platform', `linux/${ARCH}`, '--user', HOST_UID, REF,
            'sh', '-c', `set -e\n${script}`,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        out.trim().split('\n').filter(Boolean).forEach((line) => console.log(`  ${line}`));
    } catch (e) {
        failed += 1;
        const detail = (e.stdout?.toString() || '') + (e.stderr?.toString() || e.message);
        console.error(`  FAIL  ${name}`);
        detail.trim().split('\n').slice(-6).forEach((line) => console.error(`        ${line}`));
    }
}
console.log(`\ngate-toolchain: ${CHECKS.length - failed}/${CHECKS.length} checks passed`);
process.exit(failed ? 1 : 0);

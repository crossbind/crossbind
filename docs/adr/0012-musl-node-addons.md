# ADR-0012: Build musl Linux addons as their own platform, `linuxmusl`, in the `linux` image

- **Status:** Proposed
- **Date:** 2026-10-02
- **Affects:** `core/crossbind/src/utils/{targets,pullDockerImage}.js`, `src/actions/{run,licenses}.js`, `core/embind-napi/{js/loader.js,js/addonPlatform.js,cpp/CMakeLists.txt,cpp/check-undefined.cmake}`, `tooling/docker/{linux.Dockerfile,linuxmusl-sysroot.txt}`, `ports/*/linuxmusl`, the port recipes' platform tables, `scripts/release/workspace-release.mjs`

## Context

ADR-0011's `linux` addons link against glibc 2.28, so Alpine and other musl distributions cannot run
them. Loaded into node on Alpine, a glibc addon crashed the process with a segmentation fault, with
gcompat installed or not. The other way round fails too: a musl addon names
`libc.musl-<arch>.so.1`, which glibc systems do not have. Node reports `process.platform` as `linux`
on both, and the packages that ship native addons split them (napi-rs: `-linux-x64-gnu` and
`-linux-x64-musl`; sharp: `linux` and `linuxmusl`).

## Decision

musl is a platform of its own, `linuxmusl`, next to `linux`, which stays glibc.

- `platform: 'linuxmusl'`, `arch: 'arm64' | 'x64'`, `runtimeEnv: 'node'`, opt-in like the other addon
  platforms. Port variants live in `ports/<name>/linuxmusl` (`@crossbind/port-<name>-linuxmusl`).
  `linux` keeps its name and meaning, so the common case still maps to `process.platform`.
- The `linux` image builds both. Next to the glibc sysroots it carries musl 1.2.5 sysroots made of
  Alpine 3.23 packages, the release Node's own musl builds are made on, each pinned by SHA-256 after
  it verified against the signed APKINDEX, and a static libc++ built against each. No new image role.
- libc++abi keeps its own `__cxa_thread_atexit` on musl: musl has no `__cxa_thread_atexit_impl`, and
  the library probe cannot find that out in an image build where nothing links.
- The loader tells the two apart at run time: a process whose report header names no glibc
  (`glibcVersionRuntime`) loads `<name>.linuxmusl-<arch>.node`.
- The post-link symbol check accepts an unversioned symbol that the sysroot's musl libc defines,
  since musl versions none of its symbols.

## Consequences

- **Positive** — Alpine 3.21 and newer, arm64 and x64, runs the same addons: all 16 port families
  answered there with the values the glibc build gives (GDAL with 180 drivers). Fixing the symbol
  check for musl also fixed it for glibc, where a failed `MATCHES` had cleared the captured name, so
  a single unresolved symbol passed and several were reported without names.
- **Negative** — 16 more npm packages, each needing a Trusted Publisher and a slot in the release
  train. The linux image grows by two sysroots and two libc++ builds. The Alpine pins have to move by
  hand when 3.23's packages are superseded; no dependency-automation unit covers them yet.

## Alternatives considered

- **musl archives inside the `linux` packages** — rejected: every glibc build would download them,
  and `-p linux` would have to build both C libraries by default.
- **Renaming `linux` to `linux-gnu`** — rejected: it breaks the `process.platform` mapping for the
  common case and renames 16 packages, the `-p` value and the toolchain files for symmetry alone.
- **A separate `linuxmusl` image** — rejected: a new role in every publish, pin, gate and smoke list.
- **An LLVM-only musl runtime (compiler-rt, libunwind)** — not now: the glibc side links libgcc too,
  and Alpine's own clang uses the GCC runtime the same way.

## See also

- Related ADRs: ADR-0011, ADR-0009
- Related code: `tooling/docker/linuxmusl-sysroot.txt`, `core/embind-napi/js/addonPlatform.js`, `ports/*/linuxmusl`

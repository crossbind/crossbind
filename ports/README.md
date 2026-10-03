# crossbind Packages

This directory holds the recipe families behind the prebuilt `@crossbind/port-*`
npm packages. Each family directory contains:

- the **family (recipe) package** — `@crossbind/port-<name>`: the build recipe
  (`build.mjs`), the upstream pin and the license metadata; it distributes no
  upstream code itself,
- **platform variants** — `-wasm`, `-wasi`, `-android`, `-ios`, `-darwin`,
  `-linux`, `-linuxmusl`, `-win32`: prebuilt archives for one platform each
  (`-darwin`, `-linux`, `-linuxmusl` and `-win32` are macOS, Linux on glibc,
  Linux on musl and Windows, for native Node.js addons),
- optionally a **`-bin-wasi` tool package**: the upstream CLI built as a WASI
  component, installable from npm with per-tool commands.

The rest of this document is the **Bin & License Contract (v1)** — the rules
every package here is built and published under, and the schemas the engine
derives everything from. Downstream products consuming these packages are
consumers only; nothing here depends on them.

> **Not legal advice.** This document records mechanisms and facts. Whether a
> given use of the published artifacts meets your obligations is an assessment
> you make yourself.

## A. The four rules

**K1 — Library packages never publish executables.**
`scripts/check-publish-hygiene.js` inspects every package's
`npm pack --dry-run` file list: any file under `dist/prebuilt/**/bin/` that is
neither a `*-config` script nor declared `publish: true` in the recipe's bin
map is an error. Wired into the root `check` chain and CI. Note: on a fresh
checkout most packages have no dist, so the CI leg is partial — the real gate
is local `pnpm check` plus the pre-publish build.

**K2 — `-bin` packages declare their tool surface as data.**
The map lives in the recipe (`crossbind.build.js` → `bin` block; build-driving data
belongs in the build file). There are no hand-written scripts inside the
package: the engine (`crossbind` core, `actions/buildBinTools.js`, runs at the end
of every build) derives four things from the map —
`dist/prebuilt/<host>/crossbind-bin.json` (pure-data runtime source for launchers),
`.npmignore` (hand negation forbidden), the multitool binary when the map
declares multicall entries, and (unless `commands: false`) the npm command
surface (§B). Schema in §C.
Engine notes from real recipes: `multicall.linkFlags` (e.g. proj needs
`-Wl,--allow-multiple-definition` for its optargpm.h copies), cmake
helper-object reuse for multi-source tools, flags.make shell-unquoting,
`build.makePhases` (openssl's separate `make all` / `make install`). A link
that produces no output fails loudly (the `-o` path is replaced by regex, all
of the target's object tokens are cleared, and the output's existence is
checked).

**K3 — NOTICE/SBOM are derived at build time, never hand-written.**
Scope: packages whose dist carries upstream code (archives, binaries, data).
Recipe-only family packages distribute no upstream code and therefore carry no
artifacts; their upstream license identity lives in the manifest's
`crossbind.upstream.license` block (§D).
Machinery: `crossbind licenses --notices --sbom` (core: `actions/licenses.js` reads
the §D upstream layer, walks the resolved graph including the root package and
pulls license texts from the family's extracted source tree) plus the thin
wrapper `scripts/generate-third-party.js` (writes next to
`dist/prebuilt/<host>/`). The outputs ship in the npm tarball.

**K4 — `-bin` packages carry provenance metadata.**
A machine-readable `crossbind.provenance` block in package.json (namespaced under
`crossbind` so it cannot be confused with npm's signed provenance attestations):
the producing recipe package and version (plus `nativeVersion`), the upstream
source tarball URL and sha256, the build environment, and a pointer to the
dist SBOM as the full statically-linked component inventory. Environment
record: the digest-pinned docker image is always recorded as the canonical
reproduction environment; `builder: host` builds additionally record the host
platform and the wasi-sdk identity (VERSION file: release plus wasi-libc/llvm
pins) and the clang binary's sha256. The engine derives the block on every
wasi build (`buildBinTools`) — nothing is hand-maintained; the block records
the environment of the packaging build. The hygiene checker enforces it as the
K4 gate: block present, required fields set, and the referenced SBOM actually
in the tarball. The block documents the reproducible recipe of a statically
linked artifact — the obligation assessment stays with the user (not legal
advice).
The npm `license` field of a `-bin` package is derived the same way: the
artifact statically links every component, so the field is the AND of all
effective component licenses (including vendored copies and the toolchain
runtime; OR expressions without a recorded election stay parenthesized).
The root `LICENSE` file is derived too: an aggregate cover carrying the same
expression, followed by EVERY component's license section with its full text
(the same rows the NOTICE and SBOM are built from, so the four artifacts can
never tell different stories). A hand-typed single license on an aggregate
binary - or a missing/out-of-sync LICENSE file - is a K4 violation.

**Cleanup precedent (K1 applied).** The decision principle is *don't build*
rather than "build but don't publish": build time is saved and no licensed
artifact ever appears in dist. When a CLI is wanted, it is born as a separate
`-bin` package subject to K2-K4.

| Package | Leak | Fix |
|---|---|---|
| geotiff | applygeo/geotifcp/listgeo | `sourceReplaceList`: dropped `bin` from Makefile.in SUBDIRS |
| sqlite3 | `sqlite3` shell | the Makefile's `HAVE_WASI_SDK` shell gate pinned closed on every platform |
| iconv | `iconv` CLI | the wasi-specific src/srclib drop patch made universal |
| geos | `geosop` (was on for android) | `-DBUILD_GEOSOP=OFF` unconditionally |
| openssl | — | verified: `no-apps` already on for all platforms; bin dirs were empty |

## B. Single-source flow

```
crossbind.build.js "bin" block (the map, §C — single source)
        │  crossbind core engine (buildBinTools, at the end of every build)
        ├─ dist/prebuilt/<host>/crossbind-bin.json      (pure-data runtime source)
        ├─ .npmignore                               (derived; hand negation forbidden)
        ├─ multitool binary                         (when the map declares multicall entries)
        └─ npm command surface: generated bin/<tool>-wasi.mjs shims
             + the package.json "bin" field. A shim is two lines and imports
             the runner from crossbind itself (`crossbind/src/runtime/wasiRun.mjs`;
             no copies — crossbind is a runtime dependency of bin packages).
             The runner resolves everything at call time from crossbind's single
             sources: the target path from utils/targets.js, mounts and guest
             env from the targetSpecs data/env declarations in the package's
             crossbind.config.js graph (`_CROSSBIND_DATA_PATH_` → `/data`; user env is
             never overridden; e.g. the proj family declares PROJ_DATA, the
             gdal family GDAL_DATA plus CPL settings, openssl-wasi
             CURL_CA_BUNDLE). It also handles the wasmtime check, cwd preopen,
             socket flags, env forwarding, the three states and multicall
             dispatch. Command names are `<tool>-wasi` (never shadow a native
             install); `commands: false` opts a package out (§C).
```

## C. Bin map schema

```jsonc
// crossbind.build.js
"bin": {
  "commands": false,   // optional opt-out: skip npm command shims (default: generate)
  "tools": {
    "gdal":    { "kind": "binary", "publish": true  },
    "ogr2ogr": { "kind": "binary", "publish": false }   // known-but-unpublished
    // kinds:
    //   "alias"           → argument translation onto a unified CLI (waiting on RFC 104, §F)
    //   "multicall-entry" → the engine builds one multitool binary from the map
    //                        (buildBinTools.buildMulticall); an unknown first argument
    //                        falls through to the host tool (drop-in). Measured examples:
    //                        gdal packs 29 tools into one bin/gdal (45,637,853 B ≈ 45.6 MB;
    //                        +240 KB over the single-tool binary; local dist 1.3 GB → 103 MB;
    //                        npm tarball 12.2 MB), proj packs 6 tools into one bin/proj
    //                        (10,642,976 B ≈ 10.6 MB; +512 KB).
  }
}
```

**Three states, runner behavior** (implemented by the crossbind runner, asserted
in the bin package e2es):

| State | Meaning | Behavior |
|---|---|---|
| built | in the map, binary present | run it |
| known | in the map, binary absent | print what an npm build ships and the from-source command (`pnpm --dir <pkg> build`), exit 1 |
| unknown | not in the map | print the known tool list, exit 1 |

From-source is a first-class mode: the command printed by the `known` state is
part of the contract. (After the multicall proof, the marginal cost of one more
tool is in the KB range — the N separate ~43 MB binaries model is closed.)

## D. Upstream license metadata schema

Single-source principle: `name` derives from the package name, `version` from
`nativeVersion`, `source.url`/`sha256` from the recipe (`build.mjs`
`getURL`/`sha256`). package.json carries only the block that needs a human
decision:

```jsonc
"crossbind": {
  "upstream": {
    "license": {
      "declared": "MIT",         // upstream SPDX expression
      "selected": null,          // human election for OR expressions; made once, derived ever after
      "files": ["LICENSE.TXT"],  // NOTICE texts are pulled from these paths in the source tree
      "copyright": null,
      "notes": "…"               // optional
    }
  }
}
```

Recorded cases: sqlite3 (`declared: "blessing"`, `files: []` — the tarball
ships no license file), iconv (only the library is built; the GPL CLI is off →
`files: ["COPYING.LIB"]`), zstd and spatialite (OR expressions with
`selected: null` — until an election is recorded the generator ships all texts
and notes the absence of an election).

### Vendored copies (`bundled`)

Upstream trees sometimes compile third-party copies into the artifact (GDAL's
internal libpng/libjpeg/giflib under `GDAL_USE_*_INTERNAL`). The recipe
declares them per platform and the license machinery turns them into
first-class notice/SBOM rows, with texts pulled from the source tree:

```js
// build.mjs
bundled: {
    wasi: [
        { name: 'libpng', version: '1.6.43', license: 'libpng-2.0', files: ['frmts/png/libpng/LICENSE'], notes: '…' },
    ],
    wasm: [/* what this platform's build actually embeds */],
}
```

## E. SBOM/NOTICE generation

The key is `(package, version, target triple, resolved dependency set, feature
flags)` — not per-package: the right NOTICE on the wrong variant is more
dangerous than a hand-written one. Outputs: `THIRD-PARTY-LICENSES.md` +
`sbom.cdx.json` (CycloneDX), next to `dist/prebuilt/<host>/`. The difference
from syft-class scanners: they inspect a finished artifact afterwards and
guess; crossbind knows the link-time ground truth — the difference is accuracy,
not existence.

`crossbind licenses --platform <p>` (passed automatically by
`scripts/generate-third-party.js` from the host dir prefix) additionally rows
up what that platform's artifact statically links beyond the package graph:
recipe-declared vendored copies (§D `bundled`) and, for wasi, the toolchain
runtime — wasi-libc (triple-licensed) and the LLVM runtimes
(libc++/libc++abi/compiler-rt/libunwind, Apache-2.0 WITH LLVM-exception),
with source links pinned to the commits recorded in the actual wasi-sdk's
VERSION file. For linux, linuxmusl and win32 it rows up what a native Node.js addon links
statically: the LLVM C++ runtime and, on Windows, the mingw-w64 startup code
and winpthreads, whose licenses ask for their notices in a binary
distribution. The emscripten runtime equivalent for wasm targets is a known
open item.

## F. Watch items

1. **Multicall, official alternative path** (thin mains + `.so` +
   `wasm-tools component link`) is blocked in our stack by the upstream
   **exceptions+PIC gate**: wasi-sdk's build config disables PIC when
   exceptions are on ("lots of builds fail with shared libraries and -fPIC …
   left for a future endeavor"). wasi-sdk 34 ships `.so` + bundled-dlopen
   officially for no-EH targets (p3 included; a real dlopen family in
   `libdl.so`) — if an EH variant lands, the dlopen-NULL decision in `stubs.c`
   reopens too.
2. **Alias translation** — until RFC 104's provisional status settles.
3. **wasm-opt/-Oz experiment** — unpack/optimize/rewrap the component with
   wasm-tools.

**Placement (decided).** The distribution's home is crossbind: users install the
`-bin` package directly (e.g. `@crossbind/port-gdal-bin-wasi`); no
product-package wrapper will be opened. The contract is placement-independent —
if this ever changes, K1-K4 travel with the binaries.

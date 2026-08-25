<!-- GENERATED from docs/api/wasi.md by scripts/build-agent-skill.mjs. Do not edit. -->

# WASI — `platform: 'wasi'` command builds

> Compiles the project into a single **WASI command component** (`<name>-wasi-wasm32-st-<buildType>.wasm`, target `wasm32-wasip3`): no JS glue, no embind bridge, runnable under any WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

## Quick start

```bash
# fastest: point crossbind at a local wasi-sdk (>= 34 - the wasm32-wasip3 sysroot is required)
#   ~/.crossbind.json →  { "WASI_SDK_PATH": "/opt/wasi-sdk" }
#   or per-run:      CROSSBIND_WASI_SDK_PATH=/opt/wasi-sdk crossbind build -p wasi
# zero-config otherwise: with no WASI_SDK_PATH set, the build runs inside the
# crossbind docker image (>= 0.3.4), which ships the sdk at /opt/wasi-sdk

crossbind build -p wasi -b release
wasmtime run --dir=. dist/<name>-wasi-wasm32-st-release.wasm arg1
```

Your `src/native` must provide `main(int, char**)` — it is the entry point.
The source archive is linked whole (its code is the root set); dependency
archives are dead-code-eliminated down to what `main` reaches, and the
`export.wholeArchive` escape hatches apply as usual.

## What differs from `platform: 'wasm'`

| | `wasm` (emscripten) | `wasi` (wasi-sdk) |
|---|---|---|
| Output | wasm + JS glue + runtime | single `.wasm` |
| Bindings | embind bridge (swig) | none — `main()` only |
| Filesystem | WASMFS / OPFS / preload | host dirs via `--dir` preopens |
| Data files | `.data.txt` preload | real `dist/data/` folder to preopen |
| Threads | `runtime: 'mt'` (workers) | not yet (the wasi threads ABI is still in flux) |
| Network | FETCH / websocket bridges | `wasi:sockets` — grant with `-S inherit-network=y -S allow-ip-name-lookup=y -S tcp=y` |
| Prebuilt ABI | emscripten sysroot | **incompatible** — packages need `wasi-wasm32-*` prebuilt variants |

## Toolchain contract (what crossbind injects)

- Compile (C and C++): `--target=wasm32-wasip3 -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID -mexception-handling -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh=false` (+ `-fwasm-exceptions` for C++). The explicit `--target` matters: the sdk's clang still defaults to wasip1. The `-mexception-handling` target feature is what unlocks wasi-libc's `setjmp.h`; engines only run the standard EH format, hence the legacy toggle.
- Link (after every archive — order matters): `-lunwind -lsetjmp -lwasi-emulated-*`, plus `assets/wasi-runtime/stubs.c` (clean-failing `dlopen` family, no-op `pthread_atfork`).
- Extra flags per target: `targetSpecs.specs.wasiFlags`.

## Prebuilt packages

Every library package has a dedicated wasi platform package —
`@crossbind/port-<name>-wasi`, next to its `-wasm`/`-android`/`-ios`
siblings — carrying the `wasi-wasm32-st-release` prebuilt: zlib, sqlite3,
tiff, geotiff, proj, gdal, jpegturbo, zstd, lerc, webp, expat, geos, iconv,
spatialite, openssl and curl. openssl builds against a custom `wasi-p3`
Configure target (static, thread-less, `OPENSSL_NO_UNIX_SOCK`); curl is
HTTP(S)-only over `wasi:sockets`, with TLS from `-wasi` openssl and no CA
path baked in (pass `CURLOPT_CAINFO`; the openssl prebuilt ships
`ssl/certs/cacert.pem`).

Depend on the `-wasi` variant when targeting wasi; `pnpm build` inside such
a package refreshes its prebuilt under the same wasi-sdk requirement as app
builds. GDAL's `__wasi__` source patches (no processes, no `mkstemp`)
travel inside its recipe, so a plain `crossbind build -p wasi` is all that is
needed.

Each `-wasi` package ships a standalone use case under `e2e/` (`pnpm e2e`,
or `pnpm e2e:wasi` at the repo root): a small C program is compiled against
the shipped archives and run under wasmtime - zlib/zstd roundtrips, a
sqlite file database, a deflate tif, geokeys, an EPSG:4326→3857 transform
through proj.db, jpeg/webp encodes, an expat parse, a geos intersection, an
iconv conversion, a spatialite `MakePoint`, an openssl sha256 digest and a
curl fetch against a local HTTP server (hermetic - the only e2e that needs
the wasmtime socket grants). The scripts SKIP politely when the wasi-sdk
(>= 34, wasm32-wasip3), wasmtime or the prebuilt is absent.

## Prebuilt CLI tools (`-bin-wasi` packages)

Where the upstream ships command-line tools, a separate
`@crossbind/port-<name>-bin-wasi` package carries them prebuilt — install
from npm and run, no compiler involved:

```bash
npm i -g @crossbind/port-gdal-bin-wasi   # or npx/pnpm dlx
gdalinfo-wasi --version                  # wasmtime must be on PATH
```

Every tool is exposed as a `<tool>-wasi` npm command (the suffix keeps a
native install unshadowed). The launcher is not hand-written per package:
each shim imports the runner from crossbind itself
(`crossbind/src/runtime/wasiRun.mjs`), which resolves the target path, the
`--dir` mounts and the guest env at call time from the package's
`crossbind.config.js` graph (the same `targetSpecs` `data`/`env` declarations
used for builds — e.g. the proj family declares `PROJ_DATA`, the gdal
family `GDAL_DATA`, openssl `CURL_CA_BUNDLE`). Tool surfaces are declared
once, as data, in the recipe's `bin` map; the engine derives the npm
commands, `.npmignore`, a pure-data `crossbind-bin.json` and — when the map
marks multicall entries — a single multitool binary that carries every
tool (gdal packs 29 tools into one `bin/gdal` for +240 KB).

The rules, schemas and enforcement behind these packages (bin map,
derived NOTICE/SBOM, `crossbind.provenance`, the derived compound `license`
field) live in the Bin & License Contract:
[`ports/README.md`](../../ports/README.md).
`crossbind licenses --notices --sbom --platform wasi` regenerates the
third-party notices and the CycloneDX SBOM next to each prebuilt.

## Limits

No processes, no dynamic loading, single-threaded; sockets exist through
`wasi:sockets` when the runtime grants them. Anything the stubs cover fails
cleanly at runtime instead of trapping at instantiation.

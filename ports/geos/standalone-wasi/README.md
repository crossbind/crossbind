# @crossbind/port-geos-standalone-wasi

The upstream **`geosop`** geometry operation CLI, built by GEOS's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-geos-wasi`](https://www.npmjs.com/package/@crossbind/port-geos-wasi) when you build your own tool, install this package when you just want to run geosop.

## Run

No compiler, no build step - the tool installs as a `geosop-wasi` command (a generated shim that runs wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-geos-standalone-wasi@beta

geosop-wasi -a "POLYGON((0 0,10 0,10 10,0 10,0 0))" \
            -b "POLYGON((5 5,15 5,15 15,5 15,5 5))" intersection
```

One-off use without installing globally: `npx -p @crossbind/port-geos-standalone-wasi@beta geosop-wasi ...`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-geos-standalone-wasi@beta

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias geosopw='wasmtime run --dir=.::/work $M-geos-standalone-wasi/dist/prebuilt/$T/bin/geosop'

geosopw -a "POLYGON((0 0,10 0,10 10,0 10,0 0))" \
        -b "POLYGON((5 5,15 5,15 15,5 15,5 5))" intersection
```

## What's inside

`bin/geosop` exactly as GEOS's build produces it (`-DBUILD_GEOSOP=ON`), statically linked. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

GEOS is distributed under the [LGPL-2.1-or-later](https://github.com/libgeos/geos/blob/main/COPYING). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

# @crossbind/port-geotiff-standalone-wasi

The upstream **libgeotiff tools** (`listgeo`, `geotifcp`, `applygeo`), built by libgeotiff's own build system, shipped as **WASI command components** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-geotiff-wasi`](https://www.npmjs.com/package/@crossbind/port-geotiff-wasi) when you build your own tool, install this package when you just want to run the tools.

## Run

No compiler, no build step - every tool installs as a `<tool>-wasi` command (generated shims that run wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-geotiff-standalone-wasi@beta

listgeo-wasi image.tif            # dump GeoTIFF metadata
geotifcp-wasi -g meta.txt in.tif out.tif
applygeo-wasi geo.txt image.tif
```

One-off use without installing globally: `npx -p @crossbind/port-geotiff-standalone-wasi@beta listgeo-wasi image.tif`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env. The tools look EPSG codes up in PROJ's `proj.db`, which `@crossbind/port-proj-wasi` ships; without it `listgeo` warns `Cannot find proj.db` and reports `PCS = 27700 (name unknown)`:

```bash
npm i @crossbind/port-geotiff-standalone-wasi@beta

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
B=$M-geotiff-standalone-wasi/dist/prebuilt/$T/bin
alias geotiffw='wasmtime run --dir=.::/work --dir=$M-proj-wasi/dist/prebuilt/$T/share/proj::/proj --env PROJ_DATA=/proj'

geotiffw $B/listgeo /work/image.tif
geotiffw $B/geotifcp -g /work/meta.txt /work/in.tif /work/out.tif
geotiffw $B/applygeo /work/geo.txt /work/image.tif
```

## What's inside

The three binaries exactly as libgeotiff's build produces them, statically linked against the family's `-wasi` prebuilt dependencies (the shipped `sbom.cdx.json` lists the exact set). Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

libgeotiff is distributed under an [MIT-style license](https://github.com/OSGeo/libgeotiff/blob/master/libgeotiff/LICENSE). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

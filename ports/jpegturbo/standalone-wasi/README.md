# @crossbind/port-jpegturbo-standalone-wasi

The upstream **libjpeg-turbo tools** (`cjpeg`, `djpeg`, `jpegtran`), built by libjpeg-turbo's own build system, shipped as **WASI command components** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-jpegturbo-wasi`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-wasi) when you build your own tool, install this package when you just want to run the tools.

## Run

No compiler, no build step - every tool installs as a `<tool>-wasi` command (generated shims that run wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-jpegturbo-standalone-wasi

cjpeg-wasi -quality 90 -outfile out.jpg in.ppm
jpegtran-wasi -rotate 90 -outfile rot.jpg out.jpg
djpeg-wasi -ppm -outfile back.ppm rot.jpg
```

One-off use without installing globally: `npx -p @crossbind/port-jpegturbo-standalone-wasi cjpeg-wasi ...`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-jpegturbo-standalone-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
B=$M-jpegturbo-standalone-wasi/dist/prebuilt/$T/bin
alias jpegw='wasmtime run --dir=.::/work'

jpegw $B/cjpeg -quality 90 -outfile /work/out.jpg /work/in.ppm
jpegw $B/jpegtran -rotate 90 -outfile /work/rot.jpg /work/out.jpg
jpegw $B/djpeg -ppm -outfile /work/back.ppm /work/rot.jpg
```

## What's inside

The three binaries exactly as libjpeg-turbo's build produces them, statically linked. Single-threaded (the SIMD paths target x86/ARM and are off on wasm). crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

libjpeg-turbo is covered by the [IJG, BSD-3-Clause and zlib licenses](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

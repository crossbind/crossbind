# @crossbind/port-webp-standalone-wasi

The upstream **WebP tools** (`cwebp`, `dwebp`, `webpinfo`), built by libwebp's own build system, shipped as **WASI command components** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-webp-wasi`](https://www.npmjs.com/package/@crossbind/port-webp-wasi) when you build your own tool, install this package when you just want to run the tools.

## Run

No compiler, no build step - every tool installs as a `<tool>-wasi` command (generated shims that run wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-webp-standalone-wasi

cwebp-wasi -quiet in.ppm -o out.webp
webpinfo-wasi out.webp
dwebp-wasi out.webp -quiet -ppm -o back.ppm
```

One-off use without installing globally: `npx -p @crossbind/port-webp-standalone-wasi webpinfo-wasi out.webp`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-webp-standalone-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
B=$M-webp-standalone-wasi/dist/prebuilt/$T/bin
alias webpw='wasmtime run --dir=.::/work'

webpw $B/cwebp -quiet /work/in.ppm -o /work/out.webp
webpw $B/webpinfo /work/out.webp
webpw $B/dwebp /work/out.webp -quiet -ppm -o /work/back.ppm
```

## What's inside

The three binaries exactly as libwebp's build produces them, statically linked. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

libwebp is distributed under the [BSD-3-Clause License](https://github.com/webmproject/libwebp/blob/main/COPYING). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

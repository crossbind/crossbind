# @crossbind/port-tiff-standalone-wasi

The upstream **libtiff tools** - all 18 that libtiff installs, from `tiffinfo` to `tiff2pdf` - built by libtiff's own build system and shipped as **WASI command components** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-tiff-wasi`](https://www.npmjs.com/package/@crossbind/port-tiff-wasi) when you build your own tool, install this package when you just want to run the tools.

## Run

No compiler, no build step - every tool installs as a `<tool>-wasi` command (generated shims that run wasmtime with the right flags and mounts, so relative paths just work):

```bash
npm i -g @crossbind/port-tiff-standalone-wasi@beta

ppm2tiff-wasi in.ppm out.tif
tiffinfo-wasi out.tif
tiffcp-wasi out.tif copy.tif
```

One-off use without installing globally: `npx -p @crossbind/port-tiff-standalone-wasi@beta tiffinfo-wasi photo.tif`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-tiff-standalone-wasi@beta

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
B=$M-tiff-standalone-wasi/dist/prebuilt/$T/bin
alias tiffw='wasmtime run --dir=.::/work'

tiffw $B/ppm2tiff /work/in.ppm /work/out.tif
tiffw $B/tiffinfo /work/out.tif
tiffw $B/tiffcp /work/out.tif /work/copy.tif
```

## What's inside

The full installed tool set, exactly as libtiff's build produces it: `fax2ps`, `fax2tiff`, `pal2rgb`, `ppm2tiff`, `raw2tiff`, `tiff2bw`, `tiff2pdf`, `tiff2ps`, `tiff2rgba`, `tiffcmp`, `tiffcp`, `tiffcrop`, `tiffdither`, `tiffdump`, `tiffinfo`, `tiffmedian`, `tiffset`, `tiffsplit`. (`rgb2ycbcr` and `thumbnail` are upstream test tools and are not installed by libtiff itself.)

One WASI-specific note: `fax2ps` reads from stdin via `tmpfile()`, which WASI's libc deliberately does not define; crossbind links a clean-failing stub, so the stdin mode declines with "Could not obtain temporary file." while file arguments work fully - this contract is asserted in the package's e2e. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

libtiff is distributed under the [libtiff license](https://gitlab.com/libtiff/libtiff/-/blob/master/LICENSE.md). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

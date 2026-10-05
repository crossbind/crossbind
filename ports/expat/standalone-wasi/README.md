# @crossbind/port-expat-standalone-wasi

The upstream **`xmlwf`** well-formedness checker, built by Expat's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-expat-wasi`](https://www.npmjs.com/package/@crossbind/port-expat-wasi) when you build your own tool, install this package when you just want to run xmlwf.

## Run

No compiler, no build step - the tool installs as an `xmlwf-wasi` command (a generated shim that runs wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-expat-standalone-wasi

xmlwf-wasi doc.xml        # silent when well-formed
xmlwf-wasi -v
```

One-off use without installing globally: `npx -p @crossbind/port-expat-standalone-wasi xmlwf-wasi doc.xml`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-expat-standalone-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias xmlwfw='wasmtime run --dir=.::/work $M-expat-standalone-wasi/dist/prebuilt/$T/bin/xmlwf'

xmlwfw /work/doc.xml
xmlwfw -v
```

## What's inside

`bin/xmlwf` exactly as Expat's build produces it, statically linked. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

Expat is distributed under the [MIT License](https://github.com/libexpat/libexpat/blob/master/COPYING). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

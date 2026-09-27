# @crossbind/port-openssl-bin-wasi

The upstream **`openssl` CLI**, built by OpenSSL's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-openssl-wasi`](https://www.npmjs.com/package/@crossbind/port-openssl-wasi) when you build your own tool, install this package when you just want to run openssl.

## Run

No compiler, no build step - the tool installs as an `openssl-wasi` command (a generated shim that runs wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-openssl-bin-wasi

openssl-wasi version
openssl-wasi dgst -sha256 file.bin
```

One-off use without installing globally: `npx -p @crossbind/port-openssl-bin-wasi openssl-wasi version`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-openssl-bin-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias opensslw='wasmtime run --dir=.::/work $M-openssl-bin-wasi/dist/prebuilt/$T/bin/openssl'

opensslw version
opensslw dgst -sha256 /work/file.bin
```

## What's inside

`bin/openssl` as OpenSSL's build produces it for a WASI target: sockets (`no-sock`) and secure memory (`no-secure-memory`) are configured out, so network subcommands (`s_client`, `s_server`) are absent, and `speed` is dropped (it needs fork/alarm). The offline command set - digests, encoding, key/cert handling - is what ships; `version` and `dgst -sha256` are exercised in this package's e2e. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

OpenSSL is distributed under the [Apache License 2.0](https://github.com/openssl/openssl/blob/master/LICENSE.txt). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

# @crossbind/port-zstd-bin-wasi

The upstream **`zstd` CLI**, built by zstd's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-zstd-wasi`](https://www.npmjs.com/package/@crossbind/port-zstd-wasi) when you build your own tool, install this package when you just want to run zstd.

## Run

No compiler, no build step - the tool installs as a `zstd-wasi` command (a generated shim that runs wasmtime with the right flags, so relative paths just work):

```bash
npm i -g @crossbind/port-zstd-bin-wasi

zstd-wasi file -o file.zst
zstd-wasi -d file.zst -o file.out
```

One-off use without installing globally: `npx -p @crossbind/port-zstd-bin-wasi zstd-wasi -d file.zst -o file`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-zstd-bin-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias zstdw='wasmtime run --dir=.::/work $M-zstd-bin-wasi/dist/prebuilt/$T/bin/zstd'

zstdw /work/file -o /work/file.zst
zstdw -d /work/file.zst -o /work/file.out
```

## What's inside

`bin/zstd` exactly as zstd's build produces it (`ZSTD_BUILD_PROGRAMS=ON`; the only WASI touch is a one-line patch stubbing `chown`, which wasi-libc lacks - ownership copying is meaningless there). Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

zstd is dual-licensed by upstream under [BSD-3-Clause](https://github.com/facebook/zstd/blob/dev/LICENSE) or [GPL-2.0](https://github.com/facebook/zstd/blob/dev/COPYING); no election is recorded, so the derived expression carries the OR and both texts ship. This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

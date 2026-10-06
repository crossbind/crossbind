# @crossbind/port-sqlite3-standalone-wasi

The upstream **`sqlite3` shell**, built by SQLite's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-sqlite3-wasi`](https://www.npmjs.com/package/@crossbind/port-sqlite3-wasi) when you build your own tool, install this package when you just want to run the shell.

## Run

No compiler, no build step - the shell installs as a `sqlite3-wasi` command (a generated shim that runs wasmtime with the cwd preopened, so relative database paths just work):

```bash
npm i -g @crossbind/port-sqlite3-standalone-wasi@beta

sqlite3-wasi :memory: 'select 40+2;'
sqlite3-wasi app.db '.tables'
sqlite3-wasi app.db 'create table t(x); insert into t values(1); select * from t;'
```

One-off use without installing globally: `npx -p @crossbind/port-sqlite3-standalone-wasi@beta sqlite3-wasi ':memory:' 'select 40+2;'`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-sqlite3-standalone-wasi@beta

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias sqlitew='wasmtime run --dir=.::/work $M-sqlite3-standalone-wasi/dist/prebuilt/$T/bin/sqlite3'

sqlitew :memory: 'select 40+2;'
sqlitew /work/app.db '.tables'
```

File databases live under the preopened directory (`--dir=.::/work`).

## What's inside

`bin/sqlite3` exactly as SQLite's build produces it, statically linked. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

SQLite is in the [public domain](https://sqlite.org/copyright.html). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

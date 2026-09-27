# @crossbind/port-proj-bin-wasi

The upstream **PROJ apps** - `proj`, `cct`, `cs2cs`, `geod`, `gie`, `projinfo` - built by PROJ's own build system and shipped as **one multicall WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-proj-wasi`](https://www.npmjs.com/package/@crossbind/port-proj-wasi) when you build your own tool, install this package when you just want to run the apps.

## Run

No compiler, no build step - every tool installs as a `<tool>-wasi` command (generated shims that run wasmtime with the right flags, mounts and env; `proj.db` is discovered and mounted automatically, multicall dispatch included):

```bash
npm i -g @crossbind/port-proj-bin-wasi

echo "2 49" | proj-wasi +proj=merc +lat_ts=56.5
echo "2 49" | cs2cs-wasi +proj=latlong +to +proj=merc +lat_ts=56.5
projinfo-wasi EPSG:4326
```

One-off use without installing globally: `npx -p @crossbind/port-proj-bin-wasi projinfo-wasi EPSG:4326`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+).

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-proj-bin-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias projw='wasmtime run --dir=.::/work --dir=$M-proj-bin-wasi/dist/prebuilt/$T/share/proj::/proj --env PROJ_DATA=/proj $M-proj-bin-wasi/dist/prebuilt/$T/bin/proj'

echo "2 49" | projw +proj=merc +lat_ts=56.5           # plain proj
echo "2 49" | projw cs2cs +proj=latlong +to +proj=merc +lat_ts=56.5
projw projinfo EPSG:4326
```

`proj.db` and the resource files ship in this package and are mounted from its own `share/proj`.

## What's inside

One binary, six tools: `bin/proj` carries `proj` itself plus `cct`, `cs2cs`, `geod`, `gie` and `projinfo` as multicall entries. The first argument picks the tool; an unrecognized first argument falls through to plain `proj`, so it stays a drop-in replacement. Costs ~0.5 MB over the single-tool binary instead of shipping six ~10 MB statically linked apps. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json` (`kind: "multicall-entry"` marks the tools dispatched through `bin/proj`).

## License

PROJ is distributed under the [MIT License](https://github.com/OSGeo/PROJ/blob/master/COPYING). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

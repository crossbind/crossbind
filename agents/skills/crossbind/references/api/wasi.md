<!-- GENERATED from docs/api/wasi.md by scripts/build-agent-skill.mjs. Do not edit. -->

# WASI — `platform: 'wasi'` commands and HTTP components

> Builds the project into one **WASI command component** (`<name>-wasi-wasm32-st-<buildType>.wasm`, target
`wasm32-wasip3`): no JavaScript glue and no bindings, for any WASI 0.3 runtime with Wasm 3.0 exceptions, such as
wasmtime 47+. With `-e http` it builds an **HTTP component** instead, which Spin, wasmCloud and `wasmtime serve` run
([HTTP components](#http-components--e-http)).

## Quick start

```bash
# zero-config: the build runs inside the crossbind docker image (>= 0.3.4), which
# ships the sdk at /opt/wasi-sdk
# fastest: build on the host with RUNNER=LOCAL and a local wasi-sdk
# (>= 34 - the wasm32-wasip3 sysroot is required)
#   per-run:            CROSSBIND_RUNNER=LOCAL CROSSBIND_WASI_SDK_PATH=/opt/wasi-sdk crossbind build -p wasi -e wasi
#   ~/.crossbind.json → { "RUNNER": "LOCAL", "WASI_SDK_PATH": "/opt/wasi-sdk" }  (every platform builds on the host then)

crossbind build -p wasi -e wasi -b release
wasmtime run --dir=. .crossbind/build/<name>-wasi-wasm32-st-release.wasm arg1
```

The command and the `data/` folder of its dependencies land in `paths.output`, which is
`.crossbind/build` unless the config sets it; with `paths: { output: 'dist' }` they are copied to
`dist/`.

Your `src/native` must provide `main(int, char**)` — it is the entry point.
The source archive is linked whole (its code is the root set); dependency
archives are dead-code-eliminated down to what `main` reaches, and the
`export.wholeArchive` escape hatches apply as usual.

## HTTP components (`-e http`)

`-e http` links the same archives into a component that exports `wasi:http/handler@0.3.0`, the export
of the `wasi:http/service` world: `<name>-wasi-wasm32-st-<buildType>.http.wasm`, with no `main()`,
which the host calls once per request. `src/native` defines the one function `<crossbind/http.h>`
declares:

```cpp
#include <crossbind/http.h>

namespace crossbind::http {

Response handle(Request request) {
    return {
        200,
        { { "content-type", "text/plain" } },
        "hello " + request.path + "\n",
    };
}

}
```

With `paths: { output: 'dist' }`:

```bash
crossbind build -p wasi -e http -b release
wasmtime serve dist/<name>-wasi-wasm32-st-release.http.wasm
```

Spin 4 serves it from a manifest like this one (`spin up`); wasmCloud's `wash dev` takes the file as
`build.component_path` in `.wash/config.yaml`:

```toml
spin_manifest_version = 2

[application]
name = "my-app"

[[trigger.http]]
route = "/..."
component = "handler"

[component.handler]
source = "dist/<name>-wasi-wasm32-st-release.http.wasm"
```

- `Request` carries `method` (`"GET"`, …), `authority` (the request's, else its `host` header), `path`
  and `query` as the client sent them (split at `?`, percent-encoding kept), `headers` with names in
  lowercase, and `body`, read whole before `handle` runs. `handle` takes the request by value, so its
  body can move into the response.
- `Response` is `status` (200 unless set), `headers` and `body`. The body is written after `handle`
  returns, as fast as the client takes it, while the instance serves other requests.
- An exception out of `handle` answers 500 and logs `crossbind: <method> <path> threw: <what>` to
  stderr; so does a status outside 100–999. A response header the host rejects is logged and left out.
- A body that does not fit in memory, or does not arrive whole, never reaches `handle`: the host gets
  `HTTP-request-body-size` or the error it reported instead of a response (`wasmtime serve` answers 500).
- Each request runs on a stack of its own, 1 MiB with no guard page below it; `-Wl,-z,stack-size=<bytes>`
  in `binary.wasiFlags` changes it.
- A host can reuse one instance for many requests, several at a time (`wasmtime serve` and Spin do;
  `wash dev` starts one per request): static state outlives a request, and `handle` runs for one
  request while the body of another is still being written. Calls of `handle` never overlap.
- While a request body is still arriving, its instance starts no other request, so a slow upload
  delays the requests the host gives that instance ([ADR-0016](../adr/0016-wasi-http-components.md)).
- Besides the imports of the `wasi:http/service` world, the component imports the `wasi:cli`
  environment, exit and terminal interfaces wasi-libc uses. The three hosts provide them; a host that
  offers only the world's imports rejects the component.
- Not yet: outgoing requests (`wasi:http/client`), streamed request or response bodies, trailers, and
  the `data` and `env` of dependencies such as PROJ, GDAL and openssl, which land in `dist/data` but
  reach the component from no host.
- Tested with `wasmtime serve` 47 and Spin 4.2 (`e2e/cloud-wasi-http`), and with `wash dev` 2.10 by hand.

## What differs from `platform: 'wasm'`

| | `wasm` (emscripten) | `wasi` (wasi-sdk) |
|---|---|---|
| Output | wasm + JS glue + runtime | single `.wasm` |
| Bindings | embind bridge (swig) | none — `main()`, or `crossbind::http::handle` with `-e http` |
| Filesystem | WASMFS / OPFS / preload | host dirs via `--dir` preopens |
| Data files | `.data.txt` preload | real `data/` folder beside the command, to preopen |
| Threads | `runtime: 'mt'` (workers) | not yet (the wasi threads ABI is still in flux) |
| Network | FETCH / websocket bridges | `wasi:sockets` — grant with `-S inherit-network=y -S allow-ip-name-lookup=y -S tcp=y` |
| Prebuilt ABI | emscripten sysroot | **incompatible** — packages need `wasi-wasm32-*` prebuilt variants |

## Toolchain contract (what crossbind injects)

- Compile (C and C++): `--target=wasm32-wasip3 -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID -mexception-handling -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh=false` (+ `-fwasm-exceptions` for C++). The explicit `--target` matters: the sdk's clang still defaults to wasip1. The `-mexception-handling` target feature is what unlocks wasi-libc's `setjmp.h`; engines only run the standard EH format, hence the legacy toggle.
- Link (after every archive — order matters): `-lunwind -lsetjmp -lwasi-emulated-*`, plus `assets/wasi-runtime/stubs.c` (clean-failing `dlopen` family, no-op `pthread_atfork`).
- `-Wl,--wrap=lseek` routes `SEEK_END` through `fstat` and an absolute `SEEK_SET`. This keeps subsequent writes at the returned position with wasi-sdk 34's p3 libc, including negative end-relative offsets.
- Extra flags per target: `targetSpecs[].specs.binary.wasiFlags`.

## Prebuilt packages

Every library package has a dedicated wasi platform package —
`@crossbind/port-<name>-wasi`, next to its `-wasm`/`-android`/`-ios`
siblings — carrying the `wasi-wasm32-st-release` prebuilt: zlib, sqlite3,
tiff, geotiff, proj, gdal, jpegturbo, zstd, lerc, webp, expat, geos, iconv,
spatialite, openssl and curl. openssl builds against a custom `wasi-p3`
Configure target (static, thread-less, `OPENSSL_NO_UNIX_SOCK`); curl is
HTTP(S)-only over `wasi:sockets`, with TLS from `-wasi` openssl and no CA
path baked in (pass `CURLOPT_CAINFO`; the openssl prebuilt ships
`ssl/certs/cacert.pem`).

Depend on the `-wasi` variant when targeting wasi; `pnpm build` inside such
a package refreshes its prebuilt under the same wasi-sdk requirement as app
builds. GDAL's `__wasi__` source patches (no processes, no `mkstemp`)
travel inside its recipe, so a plain `crossbind build -p wasi` is all that is
needed.

Each `-wasi` package has an e2e check (`pnpm e2e`, or `pnpm e2e:wasi` at the repo root) that
compiles a small C program against its archives and runs it under wasmtime. curl's fetches from a
local HTTP server, the only one that needs the wasmtime socket grants. A check is skipped when the
wasi-sdk (34 or later, wasm32-wasip3), wasmtime or the prebuilt is missing.

## Prebuilt CLI tools (`-standalone-wasi` packages)

Where the upstream ships command-line tools, a separate
`@crossbind/port-<name>-standalone-wasi` package carries them prebuilt — install
from npm and run, no compiler involved:

```bash
npm i -g @crossbind/port-gdal-standalone-wasi@beta   # or npx/pnpm dlx
gdalinfo-wasi --version                  # wasmtime must be on PATH
```

Every tool is a `<tool>-wasi` npm command, so it never shadows a native install. Each launcher
runs crossbind's own runner (`crossbind/src/runtime/wasiRun.mjs`), which takes the `--dir` mounts and
the guest environment from the package's `targetSpecs` `data` and `env` at call time: the proj
family's `PROJ_DATA`, gdal's `GDAL_DATA`, openssl's `CURL_CA_BUNDLE`. A recipe declares its tools
once, in its `bin` map; the engine derives the npm commands, `.npmignore`, `crossbind-bin.json` and,
for multicall entries, one multitool binary that carries every tool (gdal packs 29 into one
`bin/gdal`).

The rules, schemas and enforcement behind these packages (bin map,
derived NOTICE/SBOM, `crossbind.provenance`, the derived compound `license`
field) live in the Bin & License Contract:
[`ports/README.md`](../../ports/README.md).
`crossbind licenses --notices --sbom --platform wasi` regenerates the
third-party notices and the CycloneDX SBOM next to each prebuilt.

## Limits

No processes, no dynamic loading, single-threaded; sockets exist through
`wasi:sockets` when the runtime grants them. Anything the stubs cover fails
cleanly at runtime instead of trapping at instantiation.

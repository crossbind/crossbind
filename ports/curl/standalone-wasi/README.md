# @crossbind/port-curl-standalone-wasi

The upstream **`curl` CLI**, built by curl's own build system, shipped as a **WASI command component** (`wasm32-wasip3`) with [crossbind](https://crossbind.dev). Link against [`@crossbind/port-curl-wasi`](https://www.npmjs.com/package/@crossbind/port-curl-wasi) when you build your own tool, install this package when you just want to run curl.

## Run

No compiler, no build step - the tool installs as a `curl-wasi` command (a generated shim that runs wasmtime with the socket grants, the CA bundle mount and the right flags, so https and relative paths just work):

```bash
npm i -g @crossbind/port-curl-standalone-wasi

curl-wasi --version
curl-wasi -sS https://example.com -o page.html
```

One-off use without installing globally: `npx -p @crossbind/port-curl-standalone-wasi curl-wasi --version`. Requires a WASI 0.3 runtime with Wasm 3.0 exception support (wasmtime 47+). Network access runs over `wasi:sockets` - verified fetching https with full certificate verification.

### Calling wasmtime yourself

Full control over preopens, permissions and env:

```bash
npm i @crossbind/port-curl-standalone-wasi

M=node_modules/@crossbind/port
T=wasi-wasm32-st-release
alias curlw='wasmtime run -S inherit-network=y -S allow-ip-name-lookup=y -S tcp=y --dir=.::/work --dir=$M-openssl-wasi/dist/prebuilt/$T/ssl/certs::/certs --env CURL_CA_BUNDLE=/certs/cacert.pem $M-curl-standalone-wasi/dist/prebuilt/$T/bin/curl'

curlw --version
curlw -sS https://example.com -o /work/page.html
```

The CA bundle is mounted straight from the `@crossbind/port-openssl-wasi` dependency npm installs alongside - nothing is duplicated; the `curl-wasi` shim discovers the same path automatically.

## What's inside

`bin/curl` exactly as curl's build produces it: an HTTP/HTTPS-only configuration (`HTTP_ONLY=ON`, threaded resolver and unix sockets off), statically linked against the `-wasi` prebuilts of openssl for TLS. Single-threaded. crossbind's wasi runtime stubs (the dlopen family, `tmpfile`, plus `getsockname`/`getpeername` shadows covering wasmtime's current mid-connect introspection gap) ride along in every executable link.

The machine-readable tool map ships as `dist/prebuilt/<target>/crossbind-bin.json`.

## License

curl is distributed under the [curl license](https://curl.se/docs/copyright.html). This package ships a statically linked aggregate: the effective license expression of everything inside is derived into the package.json `license` field, and the root `LICENSE` file carries the full text of every bundled component. The same sections ship as `THIRD-PARTY-LICENSES.md` with a CycloneDX `sbom.cdx.json` next to the prebuilt, and the reproducible build recipe is recorded in `crossbind.provenance`. You determine what your use requires - this is not legal advice.

import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';
import { httpComponentName, httpHandlerCode, spinManifestCode } from '../../wasiHttp.js';

const WORKER = 'my-worker';
const SERVICE = 'my-service';
const WORKER_BUILD = `dist/${WORKER}-wasm-wasm32-st-release.edge`;

export default {
    slug: 'edge',
    title: 'Edge',
    description: 'Run C++ in Cloudflare Workers, or as a WASI HTTP component under wasmtime serve, Spin or wasmCloud.',
    lede: 'Two builds reach the edge. `-e edge` makes a single-threaded WebAssembly module and loader for a Cloudflare Worker. `-e http` makes a WASI HTTP component, a C++ request handler with no JavaScript, for `wasmtime serve`, Spin and wasmCloud.',
    blocks: [
        { type: 'h2', id: 'cloudflare-workers', text: 'Cloudflare Workers' },
        {
            type: 'p',
            text: 'Workers run JavaScript in V8 isolates, with no Web Workers and no `SharedArrayBuffer`, and there is no bundler plugin: the Worker imports the build output itself. Install the CLI and name the project, which names the output files:',
        },
        { type: 'code', file: 'shell', code: `npm install --save-dev crossbind${RELEASE.distTagSuffix}` },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `export default {
    general: { name: '${WORKER}' },
    paths: { config: import.meta.url, output: 'dist' },
};`,
        },
        {
            type: 'p',
            text: 'Without a bundler, the build binds every `.h` file in `src/native`, so a port is reached through a header of your own. Build; the loader and its wasm land in `dist`:',
        },
        { type: 'code', file: 'shell', code: 'npx crossbind build -p wasm -a wasm32 -r st -e edge -b release' },
        {
            type: 'code',
            file: 'index.js',
            code: `import initNative from './${WORKER_BUILD}.js';
import wasm from './${WORKER_BUILD}.wasm';

export default {
    async fetch() {
        const { Native } = await initNative({ getWasmFunction: () => wasm });
        return new Response(Native.sample());
    },
};`,
        },
        {
            type: 'p',
            text: '`Native` is a class in `src/native/native.h`. Workers cannot compile WebAssembly from bytes, so the Worker imports the `.wasm` as a module and `getWasmFunction` ([Runtime API](/guide/runtime-api/#options)) hands it to the loader. `initNative()` starts once per isolate.',
        },
        {
            type: 'p',
            text: 'Start it in the handler, not with a top-level `await`: Workers forbid random numbers in global scope, and Rust\'s standard library asks for some as the module starts. The build also writes `dist/edge/wasm.mjs`, which does both imports and exports `initNative` and every bound name; a package publishes it as its edge entry ([Publishing packages](/guide/publishing/#package-types)).',
        },
        { type: 'p', text: 'Wrangler bundles the `.wasm` import with no extra rules:' },
        {
            type: 'code',
            file: 'wrangler.toml',
            code: `name = "${WORKER}"
main = "index.js"
compatibility_date = "2024-09-08"`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx wrangler dev
npx wrangler deploy`,
        },
        {
            type: 'p',
            text: `To start from a working Worker instead, \`${CREATE_COMMAND} -- ${WORKER} Cloud "Cloudflare Worker"\` scaffolds one.`,
        },
        { type: 'h3', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**Single-threaded only.** `-r mt` and `useWorker` need Web Workers, which an isolate does not have.',
                '**Files live in memory.** `m.FS` keeps them only as long as the isolate, and there is no OPFS. Keep durable data in a store such as R2 or KV and pass it in from JavaScript.',
                '**No header constants.** `#define` and `const` values bind only for names an app imports, and a Worker imports no header.',
                '**Platform caps.** A free Worker gets 10 ms of CPU per request, and every plan caps a Worker\'s size; check your `.wasm` against yours.',
            ],
        },

        { type: 'h2', id: 'http', text: 'WASI HTTP components' },
        {
            type: 'p',
            text: '`-e http` links your C++ into a component that exports `wasi:http/handler@0.3.0` (the `wasi:http/service` world). There is no `main()` and no JavaScript: `src/native` defines the one function `<crossbind/http.h>` declares, and the host calls it for each request.',
        },
        { type: 'code', file: 'src/native/handler.cpp', code: httpHandlerCode('Called once per request, after its whole body has arrived.') },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `export default {
    general: { name: '${SERVICE}' },
    paths: { config: import.meta.url, output: 'dist' },
};`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx crossbind build -p wasi -e http -b release
wasmtime serve dist/${httpComponentName(SERVICE)}`,
        },
        { type: 'p', text: 'Spin 4 serves the same file from a manifest, with `spin up`:' },
        { type: 'code', file: 'spin.toml', code: spinManifestCode(SERVICE) },
        {
            type: 'p',
            text: 'wasmCloud\'s `wash dev` takes it as `build.component_path` in `.wash/config.yaml`. The build compiles like a [WASI command](/guide/executables/#wasi), and ports link from their `-wasi` packages.',
        },
        {
            type: 'ul',
            items: [
                '`Request` carries `method`, `authority`, `path` and `query` as the client sent them, `headers` with lowercase names, and `body`, read whole before `handle` runs. `Response` is `status` (200 unless set), `headers` and `body`.',
                'An exception out of `handle` answers 500 and logs `crossbind: <method> <path> threw: <what>` to stderr.',
                'A host can reuse one instance for many requests, so static state outlives a request. Calls of `handle` never overlap, but one can run while an earlier response body is still being written.',
                'Each request runs on a 1 MiB stack of its own; `-Wl,-z,stack-size=<bytes>` in `binary.wasiFlags` changes it.',
            ],
        },
        {
            type: 'p',
            text: 'Not there yet: outgoing requests (`wasi:http/client`), streamed request and response bodies, trailers, threads, Rust, and the data files and environment of dependencies such as PROJ, GDAL and OpenSSL, which no host passes to a component. The component also imports the `wasi:cli` environment, exit and terminal interfaces, so a host that offers only the `wasi:http/service` imports rejects it.',
        },

        {
            type: 'p',
            text: `[examples/cloud-cloudflare-worker](${REPO_URL}/tree/main/examples/cloud-cloudflare-worker) is a complete Worker; [e2e/cloud-wasi-http](${REPO_URL}/tree/main/e2e/cloud-wasi-http) builds a component and tests it under \`wasmtime serve\` and Spin.`,
        },
    ],
};

export default {
    slug: 'threading',
    title: 'Threading and workers',
    description: 'st versus mt, useWorker, and the COOP/COEP headers production needs.',
    lede: 'Two independent switches get confused constantly. `runtime: \'st\' | \'mt\'` is a build-time choice about threads inside the wasm module. `useWorker` is a runtime choice about which JavaScript thread the module lives on. You can use either, both, or neither.',
    blocks: [
        { type: 'h2', id: 'axes', text: 'The two axes' },
        {
            type: 'table',
            head: ['', 'runtime: \'st\'', 'runtime: \'mt\''],
            rows: [
                [
                    '`useWorker: false`',
                    'the default: wasm on the main thread, smallest setup',
                    'pthreads via `SharedArrayBuffer` on the main thread - needs COOP/COEP',
                ],
                [
                    '`useWorker: true`',
                    'wasm in one Web Worker, main thread stays free; required for OPFS',
                    'wasm in a worker, pthreads spawned from there - COOP/COEP plus Worker support',
                ],
            ],
        },
        {
            type: 'table',
            head: ['You want', 'Pick'],
            rows: [
                ['The quickest path to C++ in the browser', '`st`, no worker'],
                ['Persistent storage in the browser', '`st` + `useWorker: true`'],
                ['CPU-bound parallelism (image, geo, crypto)', '`mt`'],
                ['Both persistence and parallelism', '`mt` + `useWorker: true`'],
                ['Cloudflare Workers, Deno Deploy, Vercel Edge', '`st` only - neither is supported'],
                ['React Native', '`mt` when performance matters; no host configuration needed'],
            ],
        },

        { type: 'h2', id: 'mt', text: 'Turning on multithreading' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'myapp' },
    paths: { config: import.meta.url },
    target: { runtime: 'mt' },
};`,
        },
        {
            type: 'p',
            text: 'The wasm is then compiled with `-pthread`. Note that this promotes in one direction only: if any dependency is `mt`, your project becomes `mt` too - you cannot downgrade a multithreaded library back to single-threaded.',
        },

        { type: 'h2', id: 'coop-coep', text: 'The COOP/COEP requirement' },
        {
            type: 'p',
            text: 'Multithreaded wasm needs `SharedArrayBuffer`, which browsers gate behind cross-origin isolation. Your host has to send two response headers:',
        },
        {
            type: 'code',
            file: 'response headers',
            code: `Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp`,
        },
        {
            type: 'p',
            text: 'Without them `SharedArrayBuffer` is undefined and init fails quietly. Check it from the console on the deployed page:',
        },
        {
            type: 'code',
            file: 'browser console',
            code: `console.log(crossOriginIsolated);       // must be true
console.log(typeof SharedArrayBuffer);  // must be 'function'`,
        },
        {
            type: 'table',
            head: ['Host', 'Where the headers go'],
            rows: [
                ['Vite dev / preview', 'injected by `@crossbind/plugin-vite`'],
                ['Webpack / Rspack dev server', 'injected by `@crossbind/plugin-webpack`'],
                ['Vercel', 'the `headers` array in `vercel.json`'],
                ['Netlify, Cloudflare Pages', 'a `_headers` file'],
                ['nginx', '`add_header Cross-Origin-Opener-Policy same-origin;` and the COEP twin'],
                ['Express / custom server', 'middleware setting both on every response'],
            ],
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'require-corp blocks third-party assets',
            text: 'Cross-origin images, fonts and scripts stop loading unless they send `Cross-Origin-Resource-Policy: cross-origin`. Either switch to `Cross-Origin-Embedder-Policy: credentialless`, or proxy those assets through your own origin.',
        },

        { type: 'h2', id: 'use-worker', text: 'What changes with useWorker' },
        {
            type: 'p',
            text: 'The module moves into a dedicated Web Worker and the main thread talks to a bridged proxy. It looks the same; it behaves asynchronously.',
        },
        {
            type: 'table',
            head: ['Aspect', 'Without worker', 'With worker'],
            rows: [
                ['`m.add(2, 3)` returns', '`5`', '`Promise<5>`'],
                ['`new X(...)` returns', 'the instance', 'a promise - write `await new X(...)`'],
                ['`m.FS.writeFile(...)` returns', '`undefined`', 'a promise'],
                ['Synchronous callbacks into JS', 'work', 'do not - design them as promise round-trips'],
                ['OPFS storage', 'throws', 'works, when the browser supports it'],
                ['Shutting down', 'n/a', '`initNative.terminate()` kills the worker'],
            ],
        },
        {
            type: 'p',
            text: 'Set `dts: \'promise\'` in `crossbind.config.js` so the generated TypeScript matches. Embind objects such as vectors are proxied automatically; `m.toArray()` and `m.toVector()` keep working.',
        },

        { type: 'h2', id: 'limits', text: 'Where it does not apply' },
        {
            type: 'ul',
            items: [
                '**Edge runtimes** (Cloudflare Workers, Deno Deploy, Vercel Edge) have no Worker constructor and no `SharedArrayBuffer`: `st` only, in-memory filesystem only.',
                '**React Native** routes pthreads through JSI, so `mt` needs no headers and no isolation. `useWorker` is meaningless there.',
                '**Node.js** runs `mt` without any host configuration.',
            ],
        },

        { type: 'h2', id: 'pitfalls', text: 'Pitfalls' },
        {
            type: 'ul',
            items: [
                '**`mt` works in dev but not in production.** The dev plugin injected the headers; your host is not. Check `crossOriginIsolated`.',
                '**Mixing `mt` and `st` artifacts in one bundle.** Incompatible memory layouts - the loader fails with a streaming-compile error. Rebuild from clean after switching.',
                '**Assuming `mt` implies `useWorker`.** It does not; `mt` without a worker runs pthreads from the main thread.',
                '**Sync-style code against a worker runtime.** `instance.method is not a function` usually means construction returned a promise you never awaited.',
            ],
        },
    ],
};

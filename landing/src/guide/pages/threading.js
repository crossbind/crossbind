export default {
    slug: 'threading',
    title: 'Threads and workers',
    description: 'st versus mt, useWorker, and the COOP/COEP headers production needs.',
    lede: 'Two independent switches: `runtime: \'st\' | \'mt\'` is a build-time choice of threads inside the wasm module, and `useWorker` a runtime choice of the JavaScript thread the module runs on. Use either, both or neither.',
    blocks: [
        { type: 'h2', id: 'axes', text: 'The two axes' },
        {
            type: 'table',
            head: ['', 'runtime: \'st\'', 'runtime: \'mt\''],
            rows: [
                [
                    '`useWorker: true`, the browser default',
                    'wasm in one Web Worker, main thread stays free',
                    'wasm in a worker, pthreads started from there: needs COOP/COEP; OPFS on by default',
                ],
                [
                    '`useWorker: false`',
                    'wasm on the main thread, synchronous calls',
                    'pthreads through `SharedArrayBuffer` on the main thread: needs COOP/COEP',
                ],
            ],
        },
        {
            type: 'table',
            head: ['You want', 'Pick'],
            rows: [
                ['The quickest path to C++ in the browser', '`st`, the defaults'],
                ['Synchronous calls from the page', '`useWorker: false`'],
                ['Persistent storage in the browser (OPFS)', '`mt`, with the default worker'],
                ['CPU-bound parallelism (image, geo, crypto)', '`mt`'],
                ['Cloudflare Workers, Deno Deploy, Vercel Edge', '`st` only, with no worker'],
                ['React Native', 'always `mt`; no host configuration needed'],
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
            text: 'If any dependency is `mt`, your project becomes `mt` too: a multithreaded library cannot be used single-threaded.',
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
                ['Vite dev server and preview', 'sent by `crossbind()`'],
                ['Webpack and Rspack dev servers', 'sent by `crossbind()`'],
                ['Vercel', 'the `headers` array in `vercel.json`'],
                ['Netlify, Cloudflare Pages', 'a `_headers` file'],
                ['nginx', '`add_header Cross-Origin-Opener-Policy same-origin;` and the COEP twin'],
                ['Express or your own server', 'middleware that sets both on every response'],
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
            text: 'The module runs in its own Web Worker, and the page talks to it through proxies: the same API, but every call returns a promise. It is on by default in every browser; pass `useWorker: false` to keep the module on the page thread. [Worker mode](/guide/runtime-api/#worker) lists everything that changes.',
        },

        { type: 'h2', id: 'limits', text: 'Where it does not apply' },
        {
            type: 'ul',
            items: [
                '**Edge runtimes** (Cloudflare Workers, Deno Deploy, Vercel Edge) have no Worker constructor and no `SharedArrayBuffer`: `st` only, with `m.FS` in memory.',
                '**React Native** builds are always `mt`, with the device\'s own threads: no headers are needed, and `useWorker` does not apply.',
                '**Node.js** runs `mt` without any host configuration.',
            ],
        },

        { type: 'h2', id: 'pitfalls', text: 'Pitfalls' },
        {
            type: 'ul',
            items: [
                '**Works in dev, fails in production.** An `mt` build needs the headers the dev server sends and your host may not. Check `crossOriginIsolated`.',
                '**Mixed builds.** Mixing `mt` and `st` builds in one bundle fails with a streaming-compile error. Rebuild from clean after switching.',
            ],
        },
    ],
};

import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const example = (name) => `[${name}](${REPO_URL}/tree/main/examples/${name})`;

export default {
    slug: 'browser',
    title: 'Browser',
    description: 'WebAssembly in the browser: setup, a page without a bundler, workers and production hosting.',
    lede: 'In the browser your C++ runs as WebAssembly behind a JavaScript loader. A [bundler plugin](/guide/bundler-plugins/) turns each header you import into a JavaScript module, compiles the wasm while you develop and emits it with your bundle; without a bundler, the CLI builds the loader and the wasm for a `<script>` tag.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        {
            type: 'p',
            text: 'A browser project needs three things: the plugin for its bundler, a `crossbind.config.js` at the project root and a header imported from app code. The scaffolder sets up all three - React, Vue or Svelte on Vite, React on Rspack, or a page with no bundler:',
        },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Web React Vite` },
        {
            type: 'p',
            text: 'In an existing app, add the plugin for your bundler, as [Bundler plugins](/guide/bundler-plugins/) shows, and this config; [Configuration](/guide/configuration/) has the rest of what the file takes.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: {
        config: import.meta.url,
    },
};`,
        },
        {
            type: 'p',
            text: 'C++ lives in `src/native`. Import a header and call `initNative()` once: it boots the module and binds every header the app imports.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Native } from './native/native.h';

initNative().then(async () => {
    console.log(await Native.sample());
});`,
        },
        {
            type: 'p',
            text: 'The call returns a promise because the module runs in a Web Worker by default - see [Workers and storage](#runtime).',
        },

        { type: 'h2', id: 'no-bundler', text: 'No bundler' },
        {
            type: 'p',
            text: 'A static page builds with the CLI and loads the result with a `<script>` tag. Point `paths.output` at the folder you serve and build for the browser:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install -D crossbind${suffix}
npx crossbind build -p wasm -a wasm32 -r st -e browser -b release`,
        },
        {
            type: 'p',
            text: 'That writes `dist/my-app-wasm-wasm32-st-release.browser.js` and its `.wasm`. The script is a UMD bundle that defines a global `initNative`, so load it with a classic `<script>` tag; `path` says where the files are, relative to the page.',
        },
        {
            type: 'code',
            file: 'index.html',
            code: `<script src="./dist/my-app-wasm-wasm32-st-release.browser.js"></script>
<script>
    initNative({ path: './dist' }).then(async ({ Native }) => {
        document.querySelector('#out').textContent = await Native.sample();
    });
</script>`,
        },
        {
            type: 'p',
            text: 'Nothing reads your imports here, so the build binds every `.h` file under `src/native`, and a library reaches the page through a header of your own. There is no dev server and no rebuild on save.',
        },

        { type: 'h2', id: 'runtime', text: 'Workers and storage' },
        {
            type: 'p',
            text: 'In a browser, `initNative()` starts the module in a Web Worker: `useWorker` defaults to on wherever `Worker` exists. The page thread never blocks on C++, and every call returns a promise, construction included (`await new X()`). Set `dts: \'promise\'` in `crossbind.config.js` so the generated TypeScript says the same.',
        },
        {
            type: 'p',
            text: 'Pass `useWorker: false` to keep the module on the page thread, where calls return their values directly and a long call blocks the page:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `initNative({ useWorker: false }).then(() => {
    console.log(Native.sample());
});`,
        },
        {
            type: 'p',
            text: 'Files under `/opfs/<app>/` survive a reload; OPFS needs the worker, and the generated loader turns it on by default only for `mt` builds. Files under `/memfs/<app>/` live in memory for the session. [Files](/guide/filesystem/) covers both, and [Threads and workers](/guide/threading/) how `useWorker` and `runtime: \'mt\'` combine - they are independent.',
        },

        { type: 'h2', id: 'dev', text: 'Development' },
        {
            type: 'p',
            text: 'The first dev start compiles the wasm in Docker, or on a [remote runner](/guide/remote-builds/), and takes a while; later starts reuse the cache in `.crossbind/`. Dev servers build the debug variant, production builds the release one.',
        },
        {
            type: 'p',
            text: 'Saving a header, a C++ source or a `.rs` file in `src/native` rebuilds the wasm and reloads the page, and a function you newly import from a [library header](/guide/bindings/#imports) binds when you save the importing file. The Vite and webpack dev servers, and `vite preview`, send the COOP/COEP headers, so a multithreaded build runs locally as it is.',
        },

        { type: 'h2', id: 'production', text: 'Production build' },
        {
            type: 'p',
            text: '`vite build`, `rspack build` or a production webpack build compiles the release variant and writes `crossbind.js`, `crossbind.wasm` and, when the project packs [data files](/guide/assets/), `crossbind.data.txt` into the output directory. Deploy them with the bundle. The generated code loads them from Vite\'s `base` or webpack\'s `output.publicPath` (`auto` included), so an app served from a sub-path finds them.',
        },
        {
            type: 'p',
            text: 'A single-threaded build needs no special headers. A `runtime: \'mt\'` build needs `SharedArrayBuffer`, which browsers enable only on a cross-origin isolated page, so the production host has to send:',
        },
        {
            type: 'code',
            file: 'response headers',
            code: `Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp`,
        },
        {
            type: 'p',
            text: 'Without them `SharedArrayBuffer` is undefined and the module fails to start; `crossOriginIsolated` must be `true` in the console of the deployed page. [Threads and workers](/guide/threading/#coop-coep) shows where each host takes the headers. GitHub Pages cannot send them, so a multithreaded build does not run there.',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**Next.js** has no example or test in the repository, and the webpack plugin does not run under Turbopack.',
                '**COEP in development.** The dev servers send `Cross-Origin-Embedder-Policy: require-corp` for every build, single-threaded too, so a cross-origin image or script without a `Cross-Origin-Resource-Policy` header fails to load in dev but not in production.',
                '**Synchronous callbacks into page code** do not cross the worker: design them as promise round-trips, or set `useWorker: false`.',
            ],
        },
        {
            type: 'p',
            text: `Complete apps: ${example('web-react-vite')}, ${example('web-vue-vite')}, ${example('web-svelte-vite')}, ${example('web-react-rspack')} and ${example('web-vanilla')} - each one is also a scaffolder template.`,
        },
    ],
};

import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const example = (name) => `[${name}](${REPO_URL}/tree/main/examples/${name})`;

export default {
    slug: 'browser',
    title: 'Browser',
    description: 'WebAssembly in the browser: setup, a page without a bundler, workers and production hosting.',
    lede: 'In the browser your C++ runs as WebAssembly behind a JavaScript loader. A [bundler plugin](/guide/bundler-plugins/) turns each header you import into a module and ships the wasm with your bundle; without a bundler, the CLI builds both for a `<script>` tag.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        {
            type: 'p',
            text: 'A browser project needs the plugin for its bundler, a `crossbind.config.js` at the root and a header imported from app code. The scaffolder sets up all three for React, Vue or Svelte on Vite, React on Rspack, or a page with no bundler:',
        },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Web React Vite` },
        {
            type: 'p',
            text: 'In an existing app, add `crossbind()` to your bundler ([Bundler plugins](/guide/bundler-plugins/)) and this config:',
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
            text: 'C++ lives in `src/native`. Import a header and call `initNative()` once:',
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
            text: 'Calls return promises because the module runs in a Web Worker by default; see [Workers and storage](#runtime).',
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
            text: 'That writes `dist/my-app-wasm-wasm32-st-release.browser.js` and its `.wasm`. Load the script with a classic `<script>` tag: it defines a global `initNative`. `path` says where the files are, relative to the page.',
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
            text: 'Without a bundler, the build binds every `.h` file in `src/native`, and a library reaches the page through a header of your own. There is no dev server and no rebuild on save.',
        },

        { type: 'h2', id: 'runtime', text: 'Workers and storage' },
        {
            type: 'p',
            text: 'In a browser, `initNative()` starts the module in a Web Worker. The page never blocks on C++, and every call returns a promise, construction included (`await new X()`). Set `dts: \'promise\'` in `crossbind.config.js` so the generated types say the same.',
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
            text: 'Files under `/opfs/<app>/` survive a reload; OPFS needs the worker and is on by default only in `mt` builds. Files under `/memfs/<app>/` last for the session. More in [Files](/guide/filesystem/). `useWorker` and `runtime: \'mt\'` are independent choices ([Threads and workers](/guide/threading/)).',
        },

        { type: 'h2', id: 'dev', text: 'Development' },
        {
            type: 'p',
            text: 'The first dev start compiles in Docker (or on a [remote runner](/guide/remote-builds/)) and takes a while; later starts reuse the cache in `.crossbind/`. Dev servers build debug, production builds release.',
        },
        {
            type: 'p',
            text: 'Saving a header, a C++ source or a `.rs` file in `src/native` rebuilds and reloads the page. The Vite and webpack dev servers, and `vite preview`, send the COOP/COEP headers, so a multithreaded build runs locally.',
        },

        { type: 'h2', id: 'production', text: 'Production build' },
        {
            type: 'p',
            text: 'A production build (`vite build`, `rspack build` or webpack) writes `crossbind.js`, `crossbind.wasm` and, with [data files](/guide/assets/), `crossbind.data.txt` to the output folder. Deploy them with the bundle. They load from Vite\'s `base` or webpack\'s `output.publicPath`, so an app on a sub-path finds them.',
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
            text: 'Without them the module fails to start; `crossOriginIsolated` must be `true` in the console of the deployed page. [Threads and workers](/guide/threading/#coop-coep) shows how each host sends them. GitHub Pages cannot, so a multithreaded build does not run there.',
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
            text: `Complete apps, each also a scaffolder template: ${example('web-react-vite')}, ${example('web-vue-vite')}, ${example('web-svelte-vite')}, ${example('web-react-rspack')} and ${example('web-vanilla')}.`,
        },
    ],
};

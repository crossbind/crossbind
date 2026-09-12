import { REPO_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';

// /api/: the map of crossbind's API surfaces. There is no API generator in the repository, so
// this page separates the surfaces, states the pitfalls the reference documents open with, lists
// the CLI as core/crossbind/src/bin.js defines it, and links the canonical documents under
// docs/api/ for every option and default. Nothing here is a signature the docs do not carry.

const doc = (file) => `${REPO_URL}/blob/main/docs/api/${file}`;

const REFERENCE_DOCUMENTS = [
    ['init.md', '`init(opts)` - the runtime entry point and the module helpers it returns.'],
    ['crossbind-config.md', '`crossbind.config.js` field by field: dependencies, paths, targets, runtime flags.'],
    ['crossbind-build.md', '`crossbind.build.js` lifecycle hooks for package authors.'],
    ['build-state.md', 'the `state` and `target` shapes hooks receive, and the inventory of built-in build targets.'],
    ['filesystem.md', 'OPFS, memfs, node-fs and edge filesystems, and the `useWorker` requirement.'],
    ['threading.md', "`runtime: 'st' | 'mt'`, `useWorker`, COOP/COEP and edge-runtime limits."],
    ['cpp-binding-rules.md', 'what the auto-binder accepts and the wrapper pattern for the rest.'],
    ['rust.md', '`cargo:` crate imports, app-local `.rs` sources and `export.type: \'cargo\'` packages.'],
    ['wasi.md', "`platform: 'wasi'` command builds, `-wasi` prebuilts and `-bin-wasi` tool packages."],
    ['swig-escape.md', 'hand-written SWIG `.i` files when generation is not enough.'],
    ['overrides.md', 'every override mechanism, ordered from least to most invasive.'],
    ['performance.md', 'the default Emscripten and CMake flags, and what is safe to change.'],
    ['troubleshooting.md', 'common errors mapped to the right override.'],
    ['lifecycle-and-types.md', 'why there is no JavaScript-side `delete()`, and TypeScript notes.'],
];

export default {
    kind: 'site',
    slug: 'api',
    title: 'API reference',
    kicker: 'REFERENCE',
    description: 'The two API surfaces every project touches, the third one package authors use, the CLI, and where each option is documented.',
    lede: 'crossbind has two API surfaces that get confused often: `init(opts)` at runtime and `crossbind.config.js` at build time. Package authors have a third, `crossbind.build.js`. This page keeps them apart and points at the guide and the canonical reference for each.',
    section: 'Reference',
    path: '/api',
    href: '/api/',
    eyebrow: { head: 'REFERENCE', tail: ' · API' },
    blocks: [
        {
            type: 'table',
            head: ['Surface', 'When', 'Written by', 'Guide', 'Reference'],
            rows: [
                ['`init(opts)`', 'Runtime, the moment your app calls into Wasm', 'Every consumer', `[Runtimes](${guideHref('runtimes')})`, `[init.md](${doc('init.md')})`],
                ['`crossbind.config.js`', 'Build time, read once by `crossbind build`', 'Every consumer', `[Configuration](${guideHref('configuration')})`, `[crossbind-config.md](${doc('crossbind-config.md')})`],
                ['`crossbind.build.js`', "Build time, inside a port's source folder", 'Package authors only', `[Libraries](${guideHref('libraries')})`, `[crossbind-build.md](${doc('crossbind-build.md')})`],
            ],
        },

        { type: 'h2', id: 'model', text: 'The 30-second mental model' },
        {
            type: 'p',
            text: 'At build time the `crossbind build` CLI reads `crossbind.config.js` (and, inside a port, `crossbind.build.js`) and drives Emscripten, wasi-sdk, cargo, the Android NDK or Xcode to produce `.wasm`, `.a` or `.xcframework` outputs. The bundler plugins call it for you. At runtime your app calls the generated `initNative()` once, and after it resolves every binding and the module helpers are available:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    useWorker: true,      // required for OPFS persistent storage
    fs: { opfs: true },   // the browser default
});
// m.FS, m.toVector, m.autoMountFiles, ...`,
        },

        { type: 'h2', id: 'pitfalls', text: 'Common pitfalls' },
        {
            type: 'ol',
            items: [
                '`crossbind.config.js` is not runtime configuration. It is read once by the build; putting `useWorker: true` there does nothing, that is an `init(opts)` option.',
                'OPFS persistent storage in the browser requires `useWorker: true`. The OPFS API only exists in worker scope, so mounting `/opfs/...` from the main thread throws.',
                "`runtime: 'mt'` fails silently in production without COOP/COEP headers. Dev servers inject them; production hosts need explicit configuration.",
                'Edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) have no Web Workers: no `useWorker`, no OPFS, no multithreading - single-threaded with an in-memory filesystem.',
                '`paths.native` is an array, never a string.',
            ],
        },

        { type: 'h2', id: 'cli', text: 'Command line' },
        {
            type: 'p',
            text: 'The `crossbind` package ships one CLI. The bundler plugins run `build` for you; the other commands are for inspection and maintenance.',
        },
        {
            type: 'table',
            head: ['Command', 'What it does'],
            rows: [
                ['`crossbind build`', 'Compiles the project set up with crossbind. `--platform`, `--arch`, `--runtime`, `--build-type` and `--runtime-env` select targets; `--rebuild-deps [list]` rebuilds dependencies from source instead of using prebuilts.'],
                ['`crossbind licenses`', 'Lists bundled native dependencies with SPDX licence, version and source URL. `--notices` writes THIRD-PARTY-NOTICES.md, `--sbom` a CycloneDX file, `--check` fails on a missing or invalid licence, `--platform` adds what that artifact statically links.'],
                ['`crossbind clean-deps [names...]`', 'Removes the source-rebuilt dependency cache, for all dependencies or only the named ones.'],
                ['`crossbind docker run|create|start|stop|delete`', 'Manages the toolchain container.'],
                ['`crossbind config get|set <key>`', 'Reads or writes the crossbind system configuration.'],
            ],
        },

        { type: 'h2', id: 'reference', text: 'Reference documents' },
        {
            type: 'p',
            text: 'Every option, default and constraint lives in `docs/api/` in the repository; the agent skill ships the same documents. They are the source of truth for anything this site summarises.',
        },
        { type: 'ul', items: REFERENCE_DOCUMENTS.map(([file, summary]) => `[${file}](${doc(file)}) - ${summary}`) },

        { type: 'h2', id: 'guides', text: 'Guides on the same ground' },
        {
            type: 'ul',
            items: [
                `[Configuration](${guideHref('configuration')}) - the fields of \`crossbind.config.js\`.`,
                `[Runtimes](${guideHref('runtimes')}) - browser, Node.js, edge, React Native and WASI targets.`,
                `[Filesystem](${guideHref('filesystem')}) and [Threading and workers](${guideHref('threading')}) - the two axes people mix up.`,
                `[C++ bindings](${guideHref('bindings')}) and [Rust](${guideHref('rust')}) - what the binder accepts.`,
                `[WASI commands](${guideHref('wasi')}) and [Libraries](${guideHref('libraries')}) - commands and prebuilt libraries.`,
                `[Troubleshooting](${guideHref('troubleshooting')}) - the errors people hit most.`,
            ],
        },
    ],
};

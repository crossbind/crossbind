// All landing copy lives here so wording and figures change in one place.
//
// TODO(rename): the project is moving from crossbind to crossbind, shipping as stable 2.0.
// @crossbind/* is not published yet, so `npm create crossbind` and the package names in the
// code samples below only resolve after that publish. DOCS_HOST and REPO_URL deliberately
// still point at crossbind so the links keep working. `crossbind.config.js` remains the public
// build-time config name. The boot call is the brand-neutral `initNative`, exported by every
// generated module.
//
// Content note (15 Aug 2026): every figure below is now measured or counted from this repo -
// 16 library recipes, 68 wasi commands, 30 build targets, 20 override points, one portable
// agent skill, 12 templates, the pinned upstream versions in SHOWCASE, live GitHub counters, and
// the real release notes. The performance section is gone entirely - see the note above
// RUNTIME_CHIPS for the measurements that retired it.
//
// Feature audit (17 Aug 2026): FEATURES was re-checked claim by claim against the source. Four
// statements did not survive and are gone - LTO (no -flto anywhere in the build), "pthreads
// across every core" (the pool is capped at two workers in buildWasm.js), unqualified
// dead-code elimination (Android links whole libraries) and unqualified "zero toolchain setup"
// (iOS needs local Xcode, Rust a local cargo). Do not reintroduce any of them without a commit
// that makes them true.

export const BRAND = 'crossbind';

export const VERSION = '2.0.0';

export const SITE = 'https://crossbind.dev';

// The landing page's own title and description. index.html carries the same title as the
// dev-server fallback; the build's prerender step writes these into every page's <head>
// (see main.jsx), so keep the two titles in step.
export const SITE_TITLE = `${BRAND} — import C++ and Rust like JavaScript modules`;
export const SITE_DESCRIPTION = 'No bindings, no glue, no second build system. One import runs in the browser, on iOS and Android, in Node, on Workers, and as a WASI command.';

// The guide now lives on this site (src/guide/); the exhaustive reference - API, package
// showcase, agent setup, changelog - is still on the old domain until it moves too.
// Swapping DOCS_HOST to SITE is the rest of that migration.
const DOCS_HOST = 'https://crossbind.dev';

export const REPO_URL = 'https://github.com/crossbind/crossbind';
export const API_URL = `${DOCS_HOST}/docs/api/cpp-bindings/overview`;
export const AGENT_URL = 'https://github.com/crossbind/crossbind/blob/main/docs/agent-overview.md';
export const SHOWCASE_URL = `${DOCS_HOST}/docs/package/package/showcase`;
export const CHANGELOG_URL = `${DOCS_HOST}/docs/changelog/core/crossbind`;
export const CREATE_COMMAND = 'npm create crossbind';

// Handed to a coding agent rather than typed. Package names follow the crossbind rename, so
// like CREATE_COMMAND this only resolves once 2.0 publishes - see TODO(rename) above.
export const SETUP_PROMPT = `Add crossbind to this project so I can call C++ (or Rust) from JavaScript.

First inspect the repo and tell me what you found: package manager, bundler (Vite, Webpack, Rspack, Rollup, Metro), whether it targets the browser, Node, Cloudflare Workers or React Native, and any existing C++/Rust sources or CMake project.

Then:

1. Install \`crossbind\` and the plugin matching my bundler (\`@crossbind/plugin-vite\`, \`@crossbind/plugin-webpack\` for Webpack or Rspack, \`@crossbind/plugin-rollup\`, \`@crossbind/plugin-metro\`).
2. Create \`crossbind.config.js\` at the repo root and register the plugin in my bundler config. Keep the change idempotent - do not duplicate an existing entry.
3. If I already have C++ or Rust sources, wire those up. Otherwise add one small example: a header under \`src/native/\`, imported directly from JavaScript.
4. Call \`await initNative()\` once at my app's entry point, before the first native call - import it from the header or crate the app already imports, not from a separate runtime package.
5. Run my build and report what changed, including the size of the generated WebAssembly.

Rules: do not hand-write binding or glue code - crossbind generates it from the header. Do not add a second build system. If I need a prebuilt library (GDAL, OpenSSL, SQLite, GEOS, PROJ and more), install the matching \`@crossbind/port-*\` instead of compiling it from source.

Reference: ${DOCS_HOST}/docs/guide/getting-started/introduction`;

// Counts in copy are derived from the arrays below so they cannot drift, but they still have to
// read as prose rather than as data.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const spell = (n) => NUMBER_WORDS[n] ?? String(n);

// The point of the page: this call is identical on every runtime. The boot call ships with the
// header you already import, and one initNative() binds every native module on the page.
export const UNIVERSAL_CODE = `import { initNative, Matrix } from './native/Matrix.h';
import { GDALVersionInfo } from '@crossbind/port-gdal/gdal.h';

await initNative();

const a = new Matrix(1210000, 1);
const b = new Matrix(1210000, 2);
const result = a.multiple(b);

console.log(result.get(0), GDALVersionInfo('RELEASE_NAME'));`;

// Rust arrives through the same import; `cargo:` names a crate declared in crossbind.config.js.
export const RUST_CODE = `import { initNative, Uuid } from 'cargo:uuid';
import { Version, VersionReq } from 'cargo:semver';

await initNative();

const id = Uuid.newV4().toString();
const ok = new VersionReq('^1.2').matches(new Version('1.4.0'));

console.log(id, ok);`;

export const LANGUAGE_TABS = [
    { id: 'cpp', label: 'C++', title: 'src/main.js', code: UNIVERSAL_CODE },
    { id: 'rust', label: 'Rust', title: 'src/main.js', code: RUST_CODE },
];

export const RUNTIME_CHIPS = [
    { id: 'browser', label: 'Browser', sub: 'Chrome · Firefox · Safari', tone: '#5ba3e3', glyphs: ['chrome', 'firefox', 'safari'] },
    { id: 'node', label: 'Node.js', sub: 'CJS or ESM', tone: '#5FA04E', glyphs: ['node'] },
    { id: 'rn', label: 'React Native', sub: 'iOS + Android · JSI', tone: '#61DAFB', glyphs: ['ios', 'android'] },
    { id: 'cf', label: 'CF Workers', sub: 'Edge · same wasm', tone: '#F6821F', glyphs: ['cf'] },
    { id: 'wasi', label: 'WASI', sub: 'wasmtime 47+ · wasip3', tone: '#a78bfa', glyphs: ['wasi'] },
];

// No performance section: re-running the docs' 1100×1100 matrix benchmark here (Chrome 141
// and Node 24, Apple Silicon, 15 Aug 2026) gave 2.59s / 2.51s for wasm against 2.06s / 1.92s
// for the same algorithm in plain JavaScript, so the previously published 6.75× no longer
// reproduces. A hand-written loop is where JIT JavaScript is strongest; the page sells the
// libraries you would otherwise have to rewrite instead of a speed claim it cannot back.

// gdal3.js's landing set the pattern: numbered cards, benefit-first titles, and a spec-style
// proof tag instead of marketing adjectives. Every figure below is counted from this repo.
// The hero's tabbed code block already demos "import a header / a crate", so no card repeats it,
// and the Agent section right below the grid owns the portable-skill pitch on its own.
//
// Cards carry the caveat next to the claim - the pthread pool really is capped at two workers,
// OPFS really is worker-only, Android really is the one platform without dead-code elimination.
// Hiding those does not remove them, it just moves the discovery to the user's first afternoon.
//
// `group` maps to FEATURE_GROUPS below; `guide` is a slug owned by src/guide/nav.js, which turns
// it into the href - the route never gets spelled out twice.
export const FEATURE_GROUPS = [
    { id: 'write', label: 'Write it', hint: 'The native API you expose to JavaScript' },
    { id: 'resolve', label: 'Resolve it', hint: 'How packages become a target-ready dependency graph' },
    { id: 'build', label: 'Build it', hint: 'How source turns into every required target' },
    { id: 'run', label: 'Run it', hint: 'Where the same API executes' },
    { id: 'ship', label: 'Ship it', hint: 'What reaches apps, npm and the command line' },
    { id: 'trust', label: 'Trust it', hint: 'What you can inspect before depending on it' },
];

export const FEATURES = [
    {
        id: 'bind',
        num: '01',
        group: 'write',
        guide: 'bindings',
        title: 'Bindings you never write',
        summary: 'Import a header and what it exposes is already bound — classes, inheritance, overloads, vectors, maps, enums. C++ exceptions arrive as JS exceptions, and there is no .delete() to remember: shared_ptr owns the objects.',
        tag: ['C++ HEADERS', 'EXCEPTIONS', 'NO .delete()'],
    },
    {
        id: 'rust',
        num: '02',
        group: 'write',
        guide: 'rust',
        title: 'Rust through the same import',
        summary: 'Declare a crate, then import cargo:uuid. Structs become classes, Result throws, i64 crosses as BigInt, and you write no proc-macros. Two gaps to know up front: WASI has no Rust target yet, and the mt runtime needs a nightly toolchain.',
        tag: ['cargo: CRATES', 'NO PROC-MACROS', 'WEB + iOS + ANDROID'],
    },
    {
        id: 'callbacks',
        num: '03',
        group: 'write',
        guide: 'bindings',
        title: 'Native code that calls you back',
        summary: 'emscripten::val hands C++ any JavaScript value, a callback included. Rust gets JsValue and JsFunction by identity, plus serde_json::Value when a deep copy is the safer boundary. Synchronous callbacks need a non-worker runtime.',
        tag: ['val', 'JsFunction', 'JSON'],
    },
    {
        id: 'types',
        num: '04',
        group: 'write',
        guide: 'bindings',
        title: 'TypeScript, generated',
        summary: `Every header and Rust import gets a .d.ts, written under .crossbind/ and never into your source tree. One extends line wires the lot. Worker mode? Set dts: 'promise' and the types follow.`,
        tag: ['C++ & RUST', 'WORKER-AWARE'],
    },
    {
        id: 'hmr',
        num: '05',
        group: 'write',
        guide: 'bundlers',
        title: 'Hot reload for C++ & Rust',
        summary: 'Save a header or a .rs file, watch the browser refresh. The edit-save-see loop web developers live in, now for native code.',
        tag: ['EDIT THE .H OR .RS', 'BROWSER REFRESHES'],
    },
    {
        id: 'dependency-graph',
        num: '06',
        group: 'resolve',
        guide: 'packages',
        title: 'The whole native graph, resolved',
        summary: 'Install the package you asked for. crossbind expands its transitive native dependencies, orders prerequisites before dependents and carries the same graph through library, app and WASI builds — no hand-sorted linker list.',
        tag: ['TRANSITIVE GRAPH', 'DEPENDENCY-ORDERED'],
    },
    {
        id: 'target-resolution',
        num: '07',
        group: 'resolve',
        guide: 'architecture',
        title: 'The right artifact for this target',
        summary: 'Resolution filters every package across platform, architecture, st/mt runtime, release/debug build type and browser/edge/Node environment. Each dependency contributes only the variant the current target can consume.',
        tag: ['5 TARGET SELECTORS', 'VALID VARIANTS ONLY'],
    },
    {
        id: 'prebuilt-source',
        num: '08',
        group: 'resolve',
        guide: 'packages',
        title: 'Prebuilt first. Source when you ask.',
        summary: 'Published artifacts are the fast path. Pass --rebuild-deps with one package or the whole set and crossbind switches to its published source recipe without changing how the dependency is installed or imported.',
        tag: ['PREBUILT FAST PATH', 'SOURCE ON DEMAND'],
    },
    {
        id: 'selective-rebuild',
        num: '09',
        group: 'resolve',
        guide: 'configuration',
        title: 'Rebuild one dependency, not all of them',
        summary: 'Name the source dependencies to rebuild and every other package stays on its cached or prebuilt artifact. Per-directory locks keep concurrent build commands from racing over the same dependency cache.',
        tag: ['SELECTIVE REBUILD', 'PARALLEL-SAFE CACHE'],
    },
    {
        id: 'build-matrix',
        num: '10',
        group: 'build',
        guide: 'configuration',
        title: 'One command, the full build matrix',
        summary: 'crossbind build spans every valid target by default, with wasm64 kept opt-in. Platform, architecture, runtime, release/debug and runtime-environment filters compose — each accepts comma-separated values when a release needs only part of the matrix.',
        tag: ['5 COMPOSABLE FILTERS', '30 BUILD TARGETS'],
    },
    {
        id: 'build-hooks',
        num: '11',
        group: 'build',
        guide: 'packages',
        title: 'CMake, Autotools or your own runner',
        summary: 'A package recipe can fetch or generate source, run CMake or configure + make, inject flags and environment variables, patch upstream files, copy assets or replace the build step entirely.',
        tag: ['CMAKE', 'AUTOTOOLS', 'CUSTOM HOOKS'],
    },
    {
        id: 'docker',
        num: '12',
        group: 'build',
        guide: 'quick-start',
        title: 'No toolchain to install',
        summary: 'emscripten, the Android NDK and wasi-sdk arrive together in one digest-pinned Docker image — nothing to set up, identical builds on any machine. iOS still goes through local Xcode, and Rust through your own cargo.',
        tag: ['JUST DOCKER FOR WASM · ANDROID · WASI'],
    },
    {
        id: 'incremental',
        num: '13',
        group: 'build',
        guide: 'architecture',
        title: 'Nothing rebuilds twice',
        summary: 'Headers, bridges and libraries are content-hashed, so an unchanged one comes back as (cached) in the build log instead of recompiling. Cargo keeps its own incremental cache, and the Docker image is pulled once.',
        tag: ['CONTENT-HASHED', 'PER-TARGET CACHE'],
    },
    {
        id: 'dce',
        num: '14',
        group: 'build',
        guide: 'architecture',
        title: 'Only what you use',
        summary: 'Dead-code elimination on top of -O3, plus platform-split downloads: you ship what you call and nothing else. Android is the exception — it links the whole library.',
        tag: ['DCE + -O3', 'PLATFORM-SPLIT DOWNLOADS'],
    },
    {
        id: 'override',
        num: '15',
        group: 'build',
        guide: 'configuration',
        title: 'Override anything',
        summary: 'Twenty documented override points: swap flags per target, patch sources, drop a dependency from the graph, or rebuild any prebuilt from source.',
        tag: ['20 OVERRIDE POINTS', 'REBUILD FROM SOURCE'],
    },
    {
        id: 'platforms',
        num: '16',
        group: 'run',
        guide: 'runtimes',
        title: 'One codebase, every platform',
        summary: 'WebAssembly in the browser, in Node and on the edge. Native machine code on iOS and Android through JSI. A wasip3 command for WASI. One API in front of a 30-target build matrix.',
        tag: ['4 PLATFORMS', '30 BUILD TARGETS', 'WASM · JSI · WASIP3'],
    },
    {
        id: 'ondevice',
        num: '17',
        group: 'run',
        guide: 'runtimes',
        title: 'On-device by default',
        summary: 'Your C++ and Rust run where your user is. No backend to build or pay for, no request latency, no data leaving the device. It even works offline.',
        tag: ['NO BACKEND', 'PRIVATE', 'OFFLINE'],
    },
    {
        id: 'speed',
        num: '18',
        group: 'run',
        guide: 'threading',
        title: 'Off the main thread',
        summary: `SIMD is on for every wasm build. runtime: 'mt' adds a warm pool of two pthread workers in the browser — iOS and Android get real OS threads — and useWorker: true moves the module off the main thread entirely, so even new returns a Promise. Production needs the two COOP/COEP headers; the dev server already sends them.`,
        tag: ['SIMD', '2-WORKER WASM POOL', 'NATIVE THREADS ON DEVICE'],
    },
    {
        id: 'files',
        num: '19',
        group: 'run',
        guide: 'filesystem',
        title: 'Big files, browser and Node',
        summary: 'Multi-gigabyte files through OPFS: they persist across reloads and never need to fit in one upload. Mount straight from an <input type=file> — with useWorker: true, because OPFS is worker-only. On Node the same code reads real paths on your disk.',
        tag: ['OPFS · NEEDS useWorker', 'NODE REAL PATHS'],
    },
    {
        id: 'artifacts',
        num: '20',
        group: 'ship',
        guide: 'architecture',
        title: 'One graph, every artifact',
        summary: 'The build emits browser, edge and Node .js + .wasm pairs; target-scoped headers and static libraries; and an iOS XCFramework. The WASI path produces the standalone WebAssembly command instead of JavaScript glue.',
        tag: ['JS + WASM', 'NATIVE LIBS', 'XCFRAMEWORK'],
    },
    {
        id: 'packages',
        num: '21',
        group: 'ship',
        guide: 'packages',
        title: 'Libraries as npm dependencies',
        summary: 'GDAL, OpenSSL, SQLite, GEOS, PROJ and 11 more, precompiled from the real upstream sources at pinned versions. Or publish your own — prebuilt binaries, C++ sources, a CMake project or a Rust crate. Either way the right platform variant installs itself.',
        tag: ['16 PREBUILT', '4 PACKAGE TYPES'],
    },
    {
        id: 'assets',
        num: '22',
        group: 'ship',
        guide: 'assets',
        title: 'Data files, auto-wired',
        summary: 'Coordinate databases, format tables — declare them once. crossbind ships the files to every platform and wires the env vars for you.',
        tag: ['ASSETS', 'ENV VARS', 'EVERY PLATFORM'],
    },
    {
        id: 'wasi',
        num: '23',
        group: 'ship',
        guide: 'wasi',
        title: 'Ship a CLI, no runtime',
        summary: `platform: 'wasi' turns C++ into a single .wasm command with no JS glue. 68 classic tools already ship as <tool>-wasi npm commands — gdalinfo, sqlite3, openssl and friends.`,
        tag: ['68 PREBUILT COMMANDS', 'WASIP3'],
    },
    {
        id: 'supply',
        num: '24',
        group: 'trust',
        guide: 'packages',
        title: 'A supply chain you can audit',
        summary: 'Every upstream source is sha256-pinned and fetched over https. crossbind licenses writes a THIRD-PARTY-NOTICES file and a CycloneDX SBOM for exactly what you compiled, and --check fails the build on a missing or non-SPDX license.',
        tag: ['SHA256-PINNED', 'SBOM', 'LICENSE GATE'],
    },
    {
        id: 'visibility',
        num: '25',
        group: 'trust',
        guide: 'troubleshooting',
        title: 'You can see what it did',
        summary: 'The build prints one timed line per target, cached steps included. crossbind config list --type all dumps the fully resolved configuration, and initNative({ logHandler, errorHandler }) routes native stdout and stderr wherever your app already logs.',
        tag: ['TIMED BUILD LOG', 'RESOLVED CONFIG', 'LOG HOOKS'],
    },
    {
        id: 'tested',
        num: '26',
        group: 'trust',
        guide: 'introduction',
        title: 'Tested on the platforms it claims',
        summary: 'The sample apps are built and driven in CI, not merely compiled: Playwright across React, Vue, Svelte, vanilla and a Cloudflare Worker; wasmtime for the WASI commands; Maestro on an Android emulator and an iOS simulator. Core unit tests run against coverage thresholds on Linux, macOS and Windows.',
        tag: ['PLAYWRIGHT WEB E2E', 'MAESTRO iOS + ANDROID', 'LINUX · MACOS · WINDOWS'],
    },
];

// Real but smaller capabilities; the compact detail grid keeps them visible without turning
// every switch and escape hatch into a first-class product promise. The templates belong to
// the scaffolder, COOP/COEP to the threading card, and log hooks to the visibility card.
export const FEATURE_EXTRAS = [
    'Expo config plugin',
    'memory64 targets',
    'JSPI async (experimental)',
    'SWIG escape hatch',
    'Android arm64 + x86_64',
    'monorepo paths',
    'write your own bundler plugin',
    'CommonJS + ESM modules',
    'clean dependency cache command',
];


// The eight most-reached-for of the sixteen; `tag` is the pinned upstream version this
// project actually compiles, read from each recipe's nativeVersion.
export const SHOWCASE = [
    { name: 'GDAL', desc: 'The geospatial stack — 200+ raster and vector formats', tag: 'geo · 3.13.2' },
    { name: 'OpenSSL', desc: 'TLS and crypto, real https from a WASI command', tag: 'crypto · 4.0.1' },
    { name: 'SQLite', desc: 'The database, in the browser and on device', tag: 'db · 3.53.4' },
    { name: 'PROJ', desc: 'Coordinate transforms with the EPSG database', tag: 'geo · 9.8.1' },
    { name: 'GEOS', desc: 'Planar geometry — buffers, overlays, predicates', tag: 'geo · 3.14.1' },
    { name: 'libTIFF', desc: 'TIFF read/write with JPEG, ZSTD and LERC codecs', tag: 'image · 4.7.2' },
    { name: 'libwebp', desc: 'WebP encode and decode anywhere', tag: 'image · 1.6.0' },
    { name: 'SpatiaLite', desc: 'Spatial SQL on top of SQLite', tag: 'geo · 5.1.0' },
];

export const SHOWCASE_COUNT = '16';

// Counts are hand-copied GitHub figures, so they go stale silently - re-read them from
// api.github.com/repos/crossbind/crossbind when this copy is next touched. Last checked 16 Aug 2026.
// There is no Discord and no office hours, so the row is what actually exists.
export const COMMUNITY = [
    { label: 'GitHub stars', meta: 'crossbind/crossbind', count: '146' },
    { label: 'GitHub Discussions', meta: 'Ask anything, indexed', count: 'open' },
    { label: 'Issues', meta: 'Bugs and feature requests', count: '1' },
    { label: 'Forks', meta: 'Fork it, send a PR', count: '7' },
];

// Exactly what the twelve templates cover — no Solid template and no Next.js plugin, so
// neither is listed.
export const SCAFFOLD_FRAMEWORKS = ['React', 'Vue', 'Svelte', 'Vanilla'];
export const SCAFFOLD_BUNDLERS = ['Vite', 'Rspack', 'Webpack', 'Rollup', 'Metro'];
export const SCAFFOLD_TARGETS = [
    { label: 'Web (WASM)', glyph: 'chrome', tone: '#5ba3e3' },
    { label: 'React Native', glyph: 'rn', tone: '#61DAFB' },
    { label: 'Node.js', glyph: 'node', tone: '#5FA04E' },
    { label: 'Cloudflare Workers', glyph: 'cf', tone: '#F6821F' },
];

// Typed out one line at a time by the scaffolder terminal; `delay` is the pause before the next.
export const SCAFFOLD_LINES = [
    { delay: 200, kind: 'user', text: `> ${CREATE_COMMAND}` },
    { delay: 700, kind: 'gap', text: '' },
    { delay: 200, kind: 'question', text: '? Project name › my-crossbind-app' },
    { delay: 400, kind: 'question', text: '? Where should we create your project? › ./my-crossbind-app' },
    { delay: 400, kind: 'question', text: '? What kind of project? › Web' },
    { delay: 400, kind: 'question', text: '? Choose framework / variant › React' },
    { delay: 400, kind: 'question', text: '? Choose bundler / ecosystem › Vite' },
    { delay: 700, kind: 'gap', text: '' },
    // 18 is what the React + Vite template actually contains; other templates print fewer.
    { delay: 200, kind: 'ok', text: '✓ Scaffolded 18 files into ./my-crossbind-app' },
    { delay: 400, kind: 'gap', text: '' },
    { delay: 200, kind: 'next', text: 'Next:  cd my-crossbind-app && npm install && npm run build' },
];

export const AGENT_STEPS = [
    'Detects your stack (Vite, Webpack, RN, Next…)',
    'Loads only the relevant API and integration references',
    'Makes an idempotent, reviewable config change',
    'Runs your real build and reports the diff',
];

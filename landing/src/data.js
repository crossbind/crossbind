// All landing copy lives here so wording and figures change in one place.
//
// TODO(rename): the project is moving from crossbind to crossbind, shipping as stable 2.0.
// @crossbind/* ships on the npm `beta` tag, which is the channel the site is built from
// (release.config.js); every install command carries that suffix until a stable train moves
// `latest`. DOCS_HOST and REPO_URL deliberately still point at crossbind so the links keep working. `crossbind.config.js` remains the public
// build-time config name. The boot call is the brand-neutral `initNative`, exported by every
// generated module.
//
// Content note (15 Aug 2026): every figure below is now measured or counted from this repo -
// 16 library recipes, 68 wasi commands, 30 build targets, 17 override points, one portable
// agent skill, 12 templates, the pinned upstream versions in SHOWCASE, live GitHub counters, and
// the real release notes. The performance section is gone entirely - see the note below
// RUNTIMES for the measurements that retired it.
//
// Feature audit (17 Aug 2026): FEATURES was re-checked claim by claim against the source. Four
// statements did not survive and are gone - LTO (no -flto anywhere in the build), "pthreads
// across every core" (the pool is capped at two workers in buildWasm.js), unqualified
// dead-code elimination (Android links whole libraries) and unqualified "zero toolchain setup"
// (iOS needs local Xcode, Rust a local cargo). Do not reintroduce any of them without a commit
// that makes them true.

import { PORTS } from './ports/catalog.js';
import { RELEASE } from './release.js';

export const BRAND = 'crossbind';

export const SITE = 'https://crossbind.dev';

// The landing page's own title and description. index.html carries the same title as the
// dev-server fallback; the build's prerender step writes these into every page's <head>
// (see main.jsx), so keep the two titles in step.
export const SITE_TITLE = `${BRAND} · import C++ and Rust like JavaScript modules`;
export const SITE_DESCRIPTION =
    'No bindings, no glue, no second build system. One import runs in the browser, on iOS and Android, in Node and on Workers, and builds to a WASI command too.';

// Every reference page lives on this site now; the old Docusaurus site is gone and its URLs are
// 301s in public/_redirects. Nothing here may point at a /docs/ path.
export const REPO_URL = 'https://github.com/crossbind/crossbind';
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
export const AUTHOR_URL = 'https://github.com/bugra9';
export const PRIVACY_EMAIL = 'privacy@crossbind.dev';
export const AGENT_URL = '/agent/';
export const LIBRARIES_URL = '/ports/';
export const EXAMPLES_URL = '/examples/';
export const PLAYGROUND_URL = '/playground/';
export const TUTORIAL_URL = '/tutorial/';
// The frozen cpp.js 1.x documentation (branch archive/v1-docs), linked from the version menu and
// the migration guide.
export const V1_DOCS_URL = 'https://v1.crossbind.dev';
// The `@beta` / `@next` suffix follows the resolved release channel, so a beta-era visitor never
// installs whatever `latest` happens to point at. Stable drops the suffix.
const createCommand = (manager) => `${manager} create crossbind${RELEASE.distTagSuffix}`;
export const CREATE_COMMAND = createCommand('npm');
// Each one was run against the published beta; add a manager only after doing the same.
export const CREATE_COMMANDS = ['npm', 'pnpm', 'bun'].map((manager) => ({ id: manager, label: manager, command: createCommand(manager) }));
export const installCommand = (packageName) => `npm install -D ${packageName}${RELEASE.distTagSuffix}`;

// The Skills CLI installs straight from the repository tree, so this is derived from REPO_URL
// rather than restating the host. Dropping --global installs into the current project only.
export const SKILL_COMMAND = `npx skills add ${REPO_URL}/tree/main/agents/skills --global --yes`;

// The instructions a coding agent fetches and follows: the skill first, then the integration, which works from the
// documentation alone when the skill cannot be installed. They are built with the site, so the one line a visitor
// pastes stays the same while what it leads to follows the release; the install step carries the release channel's
// dist-tag for the same reason CREATE_COMMAND does - see TODO(rename) above.
export const AGENT_PROMPT_PATH = '/agent/prompt.md';
export const SETUP_LINE = `Fetch and follow the instructions at ${SITE}${AGENT_PROMPT_PATH} to add crossbind to this project.`;
export const AGENT_PROMPT = `# Set up crossbind

These instructions add crossbind to the project in the current directory, so it can call C++ or Rust from JavaScript or TypeScript. Run the commands yourself.

## 1. Install the crossbind skill

The skill carries the project inspector, the current port catalog and the per-framework playbooks:

\`\`\`shell
${SKILL_COMMAND}
\`\`\`

If the command is unavailable or fails, go on without it: the documentation index at ${SITE}/llms.txt covers the same ground.

## 2. Add crossbind to the project

If the current directory holds no project, report that the skill is installed and stop. Otherwise use the skill, or start from ${SITE}/llms.txt and follow the links relevant to this project:

1. Identify the package manager, framework or bundler, target runtimes, existing native sources, and any crossbind configuration.
2. Choose the integration, compatible package versions, release channel, and platform variants from the documentation. Prefer supported prebuilt ports and generated bindings.${RELEASE.distTagSuffix ? ` Install every crossbind package, ports included, from the npm \`${RELEASE.distTag}\` tag; the default tag is older.` : ''}
3. Reuse existing native code. If none exists, add a minimal C++ example and call it from the application.
4. Configure the build and runtime initialization for the detected targets. Reuse existing configuration and dependency entries, preserve unrelated behavior, and apply platform requirements where relevant.
5. Run the relevant build and verify at least one JavaScript-to-native call.

Follow the repository's conventions and make the smallest complete integration. Ask the user only when missing information prevents a correct implementation.

## 3. Report

Tell the user what you installed and changed, the commands you ran and their results, and anything you could not verify. Include the Wasm artifact size when one is produced. If you installed the skill, say that a new session may be needed before it loads.
`;

// The hero's config tab: the one a project of your own would carry for the playground's hero sample
// (src/playground/samples/hero), whose files the other tabs show. The binding is `db` so the import
// stays within the 66 characters the code column holds.
export const HERO_CONFIG = `import db from '@crossbind/port-sqlite3-wasm/crossbind.config.js';

export default {
    dependencies: [db],
    cargoDependencies: {
        uuid: '{ version = "1", features = ["v4"] }',
    },
    conanDependencies: {
        zlib: '1.3.2',
    },
    paths: { config: import.meta.url },
};`;

// The band under the hero: a drawing per kind of host (components/PlatformScene.jsx) with the
// products named in text. Apple's and Microsoft's terms forbid their logos without a license but
// allow their product names for stating compatibility. `detail` (the tooltip and the llms.txt line)
// is what each target is built as, per docs/playbooks/integration/nodejs.md and the WASI and
// architecture guides. `via`, a second line, names how an app ships there.
export const RUNTIMES = [
    { id: 'browsers', scene: 'browser', title: 'Browsers', names: 'Chrome, Firefox, Safari', detail: 'WebAssembly' },
    {
        id: 'mobile',
        scene: 'phone',
        title: 'Mobile',
        names: 'iOS, Android',
        via: 'crossbind apps · React Native',
        detail: 'A crossbind app, or native code over JSI in React Native',
    },
    { id: 'server', scene: 'cloud', title: 'Server & Edge', names: 'Node.js, Cloudflare Workers', detail: 'WebAssembly, or a Node-API addon in Node.js' },
    {
        id: 'desktop',
        scene: 'laptop',
        title: 'Desktop',
        names: 'macOS, Linux, Windows',
        via: 'crossbind apps · Electron',
        detail: 'A crossbind app, a Node-API addon in Electron, or an executable or a library for macOS, Linux and Windows',
    },
    { id: 'wasi', scene: 'terminal', title: 'WASI', names: 'wasmtime 47+', detail: 'A command or a library for WASI 0.3' },
];

// The platform map under the live demo: where native code comes from, what crossbind does with it
// and what each platform gets back. Every row is a shipped capability; Apple targets build with the
// host's Xcode, the rest in the pinned Docker images. A row links to the page that explains it:
// `guide` (+ `anchor`) as for FEATURES below, or `href`. Rows the site has no page for stay plain.
export const PLATFORM_MAP = {
    title: 'From native source to every runtime.',
    lede: 'crossbind takes C++ and Rust from wherever they live, builds them for every target and hands each platform what it loads, packaged for npm.',
    sources: {
        label: 'YOUR SOURCES',
        rows: [
            { chip: '.h', title: 'Your C++', note: 'Headers in src/native', guide: 'bindings' },
            { chip: '.rs', title: 'Your Rust', note: 'Files beside your C++', guide: 'rust' },
            { chip: '@crossbind', title: 'crossbind ports', note: `${PORTS.length} prebuilt libraries`, href: LIBRARIES_URL },
            { chip: 'cargo:', title: 'crates.io', note: 'Rust crates', guide: 'crates-io' },
            { chip: 'conan:', title: 'ConanCenter', note: 'C and C++ packages', guide: 'conan' },
        ],
    },
    core: {
        rows: [
            { title: 'Bindings and TypeScript types', note: 'Generated from your imports', guide: 'architecture', anchor: 'pipeline' },
            { title: 'The dependency graph', note: 'Resolved, prebuilt first', guide: 'configuration', anchor: 'identity' },
            { title: 'Every target', note: 'One crossbind build command', guide: 'architecture', anchor: 'targets' },
            { title: 'Toolchains', note: 'Pinned Docker images; Xcode for Apple', guide: 'architecture', anchor: 'toolchain' },
            { title: 'Runners', note: 'Local, remote or crossbind cloud', guide: 'remote-builds' },
        ],
    },
    outputs: {
        label: 'WHAT YOU SHIP',
        rows: [
            { scene: 'browser', title: 'WebAssembly', note: 'Browsers, Node.js, Workers', guide: 'browser' },
            { scene: 'cloud', title: 'Node-API addons', note: 'Node.js and Electron', guide: 'node', anchor: 'addon' },
            { scene: 'phone', title: 'React Native libraries', note: 'iOS and Android, over JSI', guide: 'react-native' },
            { scene: 'app', title: 'Apps', note: 'Desktop and mobile', guide: 'apps' },
            { scene: 'laptop', title: 'Native executables', note: 'macOS, Linux, Windows', guide: 'executables', anchor: 'native' },
            { scene: 'terminal', title: 'WASI', note: 'Commands and libraries', guide: 'executables', anchor: 'wasi' },
            { scene: 'package', title: 'npm packages', note: 'Prebuilt per platform', guide: 'publishing' },
        ],
    },
};

// No performance section: re-running the docs' 1100×1100 matrix benchmark here (Chrome 141
// and Node 24, Apple Silicon, 15 Aug 2026) gave 2.59s / 2.51s for wasm against 2.06s / 1.92s
// for the same algorithm in plain JavaScript, so the previously published 6.75× no longer
// reproduces. A hand-written loop is where JIT JavaScript is strongest; the page sells the
// libraries you would otherwise have to rewrite instead of a speed claim it cannot back.

// gdal3.js's landing set the pattern: numbered cards, benefit-first titles, and a spec-style
// proof tag instead of marketing adjectives. Every figure below is counted from this repo.
// The hero's tabbed code block already demos "import a header / a crate", so no card repeats it,
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
        summary:
            'Import a header and what it exposes is already bound: classes, inheritance, overloads, vectors, maps, enums. C++ exceptions arrive as JS exceptions, and there is no .delete() to remember: shared_ptr owns the objects.',
        tag: ['C++ HEADERS', 'EXCEPTIONS', 'NO .delete()'],
    },
    {
        id: 'rust',
        num: '02',
        group: 'write',
        guide: 'rust',
        title: 'Rust through the same import',
        summary:
            'Declare a crate, then import cargo:uuid. Structs become classes, Result throws, i64 crosses as BigInt, and you write no proc-macros. Two gaps to know up front: WASI has no Rust target yet, and the mt runtime needs a nightly toolchain.',
        tag: ['cargo: CRATES', 'NO PROC-MACROS', 'WEB + iOS + ANDROID'],
    },
    {
        id: 'callbacks',
        num: '03',
        group: 'write',
        guide: 'bindings',
        title: 'Native code that calls you back',
        summary:
            'emscripten::val hands C++ any JavaScript value, a callback included. Rust gets JsValue and JsFunction by identity, plus serde_json::Value when a deep copy is the safer boundary. Synchronous callbacks need a non-worker runtime.',
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
        guide: 'browser',
        title: 'Hot reload for C++ & Rust',
        summary: 'Save a header or a .rs file, watch the browser refresh. The edit-save-see loop web developers live in, now for native code.',
        tag: ['EDIT THE .H OR .RS', 'BROWSER REFRESHES'],
    },
    {
        id: 'dependency-graph',
        num: '06',
        group: 'resolve',
        guide: 'libraries',
        title: 'The whole native graph, resolved',
        summary:
            'Install the package you asked for. crossbind expands its transitive native dependencies, orders prerequisites before dependents and carries the same graph through library, app and WASI builds. No hand-sorted linker list.',
        tag: ['TRANSITIVE GRAPH', 'DEPENDENCY-ORDERED'],
    },
    {
        id: 'target-resolution',
        num: '07',
        group: 'resolve',
        guide: 'architecture',
        title: 'The right artifact for this target',
        summary:
            'Resolution filters every package across platform, architecture, st/mt runtime, release/debug build type and browser/edge/Node environment. Each dependency contributes only the variant the current target can consume.',
        tag: ['5 TARGET SELECTORS', 'VALID VARIANTS ONLY'],
    },
    {
        id: 'prebuilt-source',
        num: '08',
        group: 'resolve',
        guide: 'libraries',
        title: 'Prebuilt first. Source when you ask.',
        summary:
            'Published artifacts are the fast path. Pass --rebuild-deps with one package or the whole set and crossbind switches to its published source recipe without changing how the dependency is installed or imported.',
        tag: ['PREBUILT FAST PATH', 'SOURCE ON DEMAND'],
    },
    {
        id: 'selective-rebuild',
        num: '09',
        group: 'resolve',
        guide: 'configuration',
        title: 'Rebuild one dependency, not all of them',
        summary:
            'Name the source dependencies to rebuild and every other package stays on its cached or prebuilt artifact. Per-directory locks keep concurrent build commands from racing over the same dependency cache.',
        tag: ['SELECTIVE REBUILD', 'PARALLEL-SAFE CACHE'],
    },
    {
        id: 'build-matrix',
        num: '10',
        group: 'build',
        guide: 'configuration',
        title: 'One command, the full build matrix',
        summary:
            'crossbind build spans every valid target by default, with wasm64 kept opt-in, and makes binaries only for the runtime environments it is given. Platform, architecture, runtime, release/debug and runtime-environment options compose, and each accepts comma-separated values when a release needs only part of the matrix.',
        tag: ['5 COMPOSABLE FILTERS', '30 BUILD TARGETS'],
    },
    {
        id: 'build-hooks',
        num: '11',
        group: 'build',
        guide: 'publishing',
        title: 'CMake, Autotools or your own runner',
        summary:
            'A package recipe can fetch or generate source, run CMake or configure + make, inject flags and environment variables, patch upstream files, copy assets or replace the build step entirely.',
        tag: ['CMAKE', 'AUTOTOOLS', 'CUSTOM HOOKS'],
    },
    {
        id: 'docker',
        num: '12',
        group: 'build',
        guide: 'quick-start',
        title: 'No toolchain to install',
        summary:
            'emscripten and wasi-sdk ship in the digest-pinned web Docker image, the Android NDK in the android one. Nothing to set up, identical builds on any machine. iOS still goes through local Xcode, and Rust through your own cargo.',
        tag: ['JUST DOCKER FOR WASM · ANDROID · WASI'],
    },
    {
        id: 'incremental',
        num: '13',
        group: 'build',
        guide: 'architecture',
        title: 'Nothing rebuilds twice',
        summary:
            'Headers, bridges and libraries are content-hashed, so an unchanged one comes back as (cached) in the build log instead of recompiling. Cargo keeps its own incremental cache, and the Docker image is pulled once.',
        tag: ['CONTENT-HASHED', 'PER-TARGET CACHE'],
    },
    {
        id: 'dce',
        num: '14',
        group: 'build',
        guide: 'performance',
        title: 'Only what you use',
        summary:
            'Dead-code elimination on top of -O3, plus platform-split downloads: you ship what you call and what it reaches, not the whole library. Android is the exception: it links the whole library.',
        tag: ['DCE + -O3', 'PLATFORM-SPLIT DOWNLOADS'],
    },
    {
        id: 'override',
        num: '15',
        group: 'build',
        guide: 'configuration',
        title: 'Override anything',
        summary:
            'Seventeen documented override points: swap flags per target, patch sources, drop a dependency from the graph, or rebuild any prebuilt from source.',
        tag: ['17 OVERRIDE POINTS', 'REBUILD FROM SOURCE'],
    },
    {
        id: 'platforms',
        num: '16',
        group: 'run',
        guide: '',
        title: 'One codebase, every platform',
        summary:
            'WebAssembly in the browser, in Node and on the edge. Native machine code on iOS and Android through JSI. A wasip3 command for WASI, with its own entry point instead of initNative. One binding model for the JavaScript targets, in front of a 30-target build matrix.',
        tag: ['4 PLATFORMS', '30 BUILD TARGETS', 'WASM · JSI · WASIP3'],
    },
    {
        id: 'ondevice',
        num: '17',
        group: 'run',
        guide: '',
        title: 'On-device by default',
        summary:
            'Your C++ and Rust run where your user is. No backend to build or pay for, no request latency, no data leaving the device. It even works offline.',
        tag: ['NO BACKEND', 'PRIVATE', 'OFFLINE'],
    },
    {
        id: 'speed',
        num: '18',
        group: 'run',
        guide: 'threading',
        title: 'Off the main thread',
        summary: `SIMD is on for every wasm build. runtime: 'mt' adds a warm pool of two pthread workers by default in the browser (iOS and Android get real OS threads), and useWorker: true moves the module off the main thread entirely, so even new returns a Promise. Production needs the two COOP/COEP headers; the dev server already sends them.`,
        tag: ['SIMD', '2-WORKER WASM POOL', 'NATIVE THREADS ON DEVICE'],
    },
    {
        id: 'files',
        num: '19',
        group: 'run',
        guide: 'filesystem',
        title: 'Big files, browser and Node',
        summary:
            'Multi-gigabyte files through OPFS: they persist across reloads and never need to fit in one upload. Mount straight from an <input type=file>. That needs useWorker: true, because OPFS is worker-only. On Node the same code reads real paths on your disk.',
        tag: ['OPFS · NEEDS useWorker', 'NODE REAL PATHS'],
    },
    {
        id: 'artifacts',
        num: '20',
        group: 'ship',
        guide: 'architecture',
        title: 'One graph, every artifact',
        summary:
            'The build emits browser, edge and Node .js + .wasm pairs; target-scoped headers and static libraries; and an iOS XCFramework. The WASI path produces the standalone WebAssembly command instead of JavaScript glue.',
        tag: ['JS + WASM', 'NATIVE LIBS', 'XCFRAMEWORK'],
    },
    {
        id: 'packages',
        num: '21',
        group: 'ship',
        guide: 'libraries',
        title: 'Libraries as npm dependencies',
        summary:
            'GDAL, OpenSSL, SQLite, GEOS, PROJ and 11 more, precompiled from the real upstream sources at pinned versions. Or publish your own: prebuilt binaries, C++ sources, a CMake project or a Rust crate. Either way you install one variant per platform you build, and the build resolves its native dependencies.',
        tag: ['16 PREBUILT', '4 PACKAGE TYPES'],
    },
    {
        id: 'assets',
        num: '22',
        group: 'ship',
        guide: 'assets',
        title: 'Data files, auto-wired',
        summary:
            'Declare coordinate databases and format tables once. crossbind ships the files to every platform and wires the env vars for you.',
        tag: ['ASSETS', 'ENV VARS', 'EVERY PLATFORM'],
    },
    {
        id: 'wasi',
        num: '23',
        group: 'ship',
        guide: 'executables',
        title: 'Ship a CLI, no JavaScript',
        summary: `platform: 'wasi' turns C++ into a single .wasm command with no JS glue. 68 classic tools already ship as <tool>-wasi npm commands: gdalinfo, sqlite3, openssl and friends. They run under wasmtime 47 or newer.`,
        tag: ['68 PREBUILT COMMANDS', 'WASIP3', 'WASMTIME 47+'],
    },
    {
        id: 'supply',
        num: '24',
        group: 'trust',
        guide: 'libraries',
        title: 'A supply chain you can audit',
        summary:
            'Every upstream source is sha256-pinned and fetched over https. crossbind licenses writes a THIRD-PARTY-NOTICES file and a CycloneDX SBOM for exactly what you compiled, and --check fails the build on a missing or non-SPDX license.',
        tag: ['SHA256-PINNED', 'SBOM', 'LICENSE GATE'],
    },
    {
        id: 'visibility',
        num: '25',
        group: 'trust',
        guide: 'troubleshooting',
        title: 'You can see what it did',
        summary:
            'The build prints one timed line per target, cached steps included. crossbind config list --type all dumps the fully resolved configuration, and initNative({ logHandler, errorHandler }) routes native stdout and stderr wherever your app already logs.',
        tag: ['TIMED BUILD LOG', 'RESOLVED CONFIG', 'LOG HOOKS'],
    },
    {
        id: 'tested',
        num: '26',
        group: 'trust',
        guide: '',
        title: 'Tested on the platforms it claims',
        summary:
            'The sample apps are built and driven in CI, not merely compiled: Playwright across React, Vue, Svelte, vanilla and a Cloudflare Worker; wasmtime for the WASI commands; Maestro on an Android emulator and an iOS simulator. Core unit tests run against coverage thresholds on Linux, macOS and Windows.',
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

// The eight most-reached-for of the catalog. Name, category and the pinned upstream version come
// from the generated ports catalog (each recipe's nativeVersion), so they cannot go stale; only
// the one-line pitch is written here. A family missing from the catalog drops off the grid.
const SHOWCASE_PITCH = {
    gdal: 'The geospatial stack, 200+ raster and vector formats',
    openssl: 'TLS and crypto, real https from a WASI command',
    sqlite3: 'The database, in the browser and on device',
    proj: 'Coordinate transforms with the EPSG database',
    geos: 'Planar geometry: buffers, overlays, predicates',
    tiff: 'TIFF read/write with JPEG, ZSTD and LERC codecs',
    webp: 'WebP encode and decode anywhere',
    spatialite: 'Spatial SQL on top of SQLite',
};
export const SHOWCASE = Object.entries(SHOWCASE_PITCH)
    .map(([family, desc]) => {
        const port = PORTS.find((entry) => entry.family === family);
        return port ? { family, name: port.name, desc, tag: `${port.category} · ${port.nativeVersion}`, href: `/ports/${family}/` } : null;
    })
    .filter(Boolean);

export const SHOWCASE_COUNT = String(PORTS.length);

// Exactly what the twelve templates cover — no Solid template and no Next.js plugin, so
// neither is listed.
export const SCAFFOLD_FRAMEWORKS = ['React', 'Vue', 'Svelte', 'Vanilla'];
export const SCAFFOLD_BUNDLERS = ['Vite', 'Rspack', 'Webpack', 'Rollup', 'Metro'];
export const SCAFFOLD_TARGETS = ['Web (WASM)', 'React Native', 'Node.js', 'Cloudflare Workers'];

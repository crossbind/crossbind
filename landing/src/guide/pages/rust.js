import { REPO_URL } from '../../data.js';

export default {
    slug: 'rust',
    title: 'Rust',
    description: 'Write Rust next to your C++ and import a .rs file from JavaScript, the way you import a header.',
    lede: 'Rust binds the way a C++ header does: plain `struct`s, `impl` blocks and `pub fn`s become classes and functions, with no proc-macros and no hand-written glue. Write the file next to your other native sources and import it.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        {
            type: 'p',
            text: 'With the default Docker runner, builds for the web, Android, Linux and Windows need no Rust on your machine: cargo runs in the toolchain image, which carries the pinned Rust and the std of every target it builds. iOS and macOS builds run cargo on your Mac, as every build does under `RUNNER=LOCAL`, so those need a Rust toolchain - `cargo` plus the platform targets. cargo doubles as the incremental cache, so unchanged code rebuilds as a no-op.',
        },
        {
            type: 'p',
            text: 'The binding layer is a single dev dependency, and the Vite, Rollup, Webpack and React Native plugins already depend on it, so most projects get it transitively:',
        },
        { type: 'code', file: 'shell', code: 'npm install -D @crossbind/core-embind-rust' },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Two limits worth knowing up front',
            text: "`platform: 'wasi'` skips Rust - there is no `wasm32-wasip3` Rust target yet. And the wasm `mt` runtime links a std built with the atomics features: the toolchain image carries one, and under `RUNNER=LOCAL` crossbind downloads the same build when your `rustc` is the pinned one. With any other `rustc` it rebuilds std on nightly, which needs `rustup toolchain install nightly --component rust-src` once.",
        },

        { type: 'h2', id: 'local-rs', text: 'Import a .rs file' },
        {
            type: 'p',
            text: 'Write Rust beside your C++ under `src/native` and import the file the way you import a header:',
        },
        {
            type: 'code',
            file: 'src/native/counter.rs',
            code: `pub struct Counter {
    total: i32,
}

impl Counter {
    pub fn new(start: i32) -> Self {
        Counter { total: start }
    }
    pub fn add(&mut self, n: i32) -> i32 {
        self.total += n;
        self.total
    }
    pub fn total(&self) -> i32 {
        self.total
    }
}`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Counter } from './native/counter.rs';

await initNative();

const counter = await new Counter(40);
console.log(await counter.add(2));`,
        },
        {
            type: 'p',
            text: "The bridge reads that one file's public items. Crates the file uses go into `packages.cargo` in `crossbind.config.js`, the same map that lets you import a crate directly, with no Rust of your own - see [crates.io](/guide/crates-io/):",
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    packages: {
        cargo: {
            geo: '0.29',
            wkt: '0.11',
        },
    },
    paths: { config: import.meta.url },
};`,
        },

        { type: 'h2', id: 'mapping', text: 'What plain Rust maps to' },
        {
            type: 'table',
            head: ['Rust', 'JavaScript'],
            rows: [
                ['`struct` + `impl` methods', 'class with methods (`Type::new` becomes the constructor)'],
                ['`&str` / `&String` parameters, `String` returns', 'strings'],
                ['`i32` / `f64` / `bool`', 'number / boolean'],
                ['`i64` / `u64`', '`BigInt`, both directions'],
                ['`Option<T>`', '`null` / `undefined` ↔ `None`'],
                ['`Result<T, E>` returns', 'throws an `Error` on `Err`'],
                ['`impl Display`', '`toString()`'],
                ['free `pub fn`', 'plain exported function'],
                ['`&OtherClass` parameters', 'pass the other class\'s instance'],
                ['`serde_json::Value`', 'real JS values, deep-copied at the boundary'],
                ['`Arc<Class>`', 'shared ownership across several JS handles'],
                ['`embind_rs::JsValue` / `JsFunction`', 'live JS values by identity, and callbacks into JS'],
            ],
        },
        {
            type: 'p',
            text: `Slices, collections, serde types and \`std::io\` streams have rows of their own in the [full table](${REPO_URL}/blob/main/docs/api/rust.md#what-plain-rust-maps-to). A function the bridge cannot carry is left out of the module - one with more than six parameters, or seven for \`new\`, for one.`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'JsValue and JsFunction need a synchronous runtime',
            text: 'React Native, a Node.js addon, or wasm `st` on the main thread, which in a browser means `useWorker: false`. Behind a worker, the browser default, functions cannot cross the boundary and identity does not survive structured cloning, so use `serde_json::Value` there.',
        },
        {
            type: 'p',
            text: "A panic inside a binding reaches JavaScript as an `Error` carrying the panic message. Treat it as a crash: on wasm the instance is spent afterwards, so start a fresh module rather than calling into it again. A wasm build that links Rust also gets a 1 MiB stack instead of Emscripten's 64 KiB; for more, set `-sSTACK_SIZE` in `targetSpecs` `binary.emccFlags`.",
        },
        {
            type: 'p',
            text: 'To ship Rust for other projects to install, publish the crate as a package: see [Publishing packages](/guide/publishing/#rust).',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: 'Generated declarations live under `.crossbind/`, never in your source tree. A `.rs` import is typed by a declaration that mirrors its path under `.crossbind/types/`, which `@crossbind/typescript-config` overlays with `rootDirs`. Add the package as a dev dependency and extend it once (TypeScript 5.5 or later):',
        },
        {
            type: 'code',
            file: 'tsconfig.json',
            code: '{ "extends": "@crossbind/typescript-config" }',
        },
        {
            type: 'p',
            text: 'The same `dts: \'promise\'` note from [C++](/guide/bindings/#typescript) applies here.',
        },
    ],
};

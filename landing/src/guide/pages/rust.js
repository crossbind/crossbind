import { REPO_URL } from '../../data.js';

export default {
    slug: 'rust',
    title: 'Rust',
    description: 'Write Rust next to your C++ and import a .rs file from JavaScript, the way you import a header.',
    lede: 'Rust binds the way a C++ header does: `struct`s, `impl` blocks and `pub fn`s become classes and functions, with no macros or glue to write. Write the file next to your other native sources and import it.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        {
            type: 'p',
            text: 'With the default Docker runner, builds for the web, Android, Linux and Windows need no Rust on your machine: cargo runs in the toolchain image. iOS and macOS builds run cargo on your Mac, as every build does under `RUNNER=LOCAL`, so those need `cargo` and the platform targets. Unchanged code does not rebuild.',
        },
        {
            type: 'p',
            text: 'The binding layer is one dev dependency. The Vite, Rollup, Webpack and React Native plugins already bring it, so most projects have it:',
        },
        { type: 'code', file: 'shell', code: 'npm install -D @crossbind/core-embind-rust' },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Two limits',
            text: "`platform: 'wasi'` skips Rust: there is no `wasm32-wasip3` Rust target yet. And under `RUNNER=LOCAL`, the wasm `mt` runtime needs a std built with atomics: with the pinned `rustc`, crossbind downloads one; with any other, it rebuilds std on nightly, which needs `rustup toolchain install nightly --component rust-src` once.",
        },

        { type: 'h2', id: 'local-rs', text: 'Import a .rs file' },
        {
            type: 'p',
            text: 'Write Rust next to your C++ in `src/native` and import the file like a header:',
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
            text: "The bridge reads that file's public items. Crates the file uses go in `packages.cargo` in `crossbind.config.js`, the same map that lets you import a crate directly ([crates.io](/guide/crates-io/)):",
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
            text: `Slices, collections, serde types and \`std::io\` streams are in the [full table](${REPO_URL}/blob/main/docs/api/rust.md#what-plain-rust-maps-to). A function the bridge cannot carry, such as one with more than six parameters (seven for \`new\`), is left out.`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'JsValue and JsFunction need a synchronous runtime',
            text: 'They work on React Native, in a Node.js addon, and in wasm `st` on the page thread (`useWorker: false` in a browser). Behind a worker, the browser default, use `serde_json::Value`: functions cannot cross and identity is lost.',
        },
        {
            type: 'p',
            text: "A panic reaches JavaScript as an `Error` with the panic message. Treat it as a crash: on wasm the instance is unusable afterwards, so start a fresh module. A wasm build that links Rust gets a 1 MiB stack instead of Emscripten's 64 KiB; for more, set `-sSTACK_SIZE` in `targetSpecs` `binary.emccFlags`.",
        },
        {
            type: 'p',
            text: 'To ship Rust for other projects to install, publish the crate as a package: see [Publishing packages](/guide/publishing/#rust).',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: 'A `.rs` import is typed like a header, through `@crossbind/typescript-config`; set it up as in [Runtime API](/guide/runtime-api/#types).',
        },
    ],
};

export default {
    slug: 'crates-io',
    title: 'crates.io',
    description: 'Import a Rust crate from crates.io into JavaScript with the cargo: scheme, without writing Rust.',
    lede: "Declare a crate in `crossbind.config.js` and import it with the `cargo:` prefix. crossbind reads the crate's own sources and generates the bridge, so you write no Rust and no glue.",
    blocks: [
        { type: 'h2', id: 'requirement', text: 'What you need' },
        {
            type: 'p',
            text: 'With the default Docker runner, no Rust on your machine for web, Android, Linux and Windows builds: cargo runs in the toolchain image, which carries the pinned Rust and the std of every target. iOS and macOS builds run cargo on your Mac with your own Rust toolchain, as every build does under `RUNNER=LOCAL` - see [Rust](/guide/rust/#setup). The first build of a crate needs the network to reach crates.io.',
        },

        { type: 'h2', id: 'declare', text: 'Declare the crate' },
        {
            type: 'p',
            text: 'Crates go under `packages.cargo` in `crossbind.config.js`; `packages` sits at the top level, next to `dependencies`. A key is the crate name; its value is what would follow `<crate> =` in a `Cargo.toml`, written as a string: a version requirement, or an inline table.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    packages: {
        cargo: {
            uuid: '{ version = "1", features = ["v4"] }',
            semver: '1',
        },
    },
    paths: { config: import.meta.url },
};`,
        },

        { type: 'h2', id: 'import', text: 'Import it' },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import { initNative, Uuid } from 'cargo:uuid';
import { Version, VersionReq } from 'cargo:semver';

await initNative();

const id = Uuid.newV4().toString();
const matches = VersionReq.parse('^1.2').matches(Version.parse('1.4.0'));`,
        },
        {
            type: 'p',
            text: 'The prefix names the store, the way `node:` does, so a crate never collides with an npm package of the same name. Every generated module exports `initNative`, and one call binds them all. Importing a crate that `packages.cargo` does not declare fails the build and tells you to add it there.',
        },
        {
            type: 'p',
            text: 'In a browser the module runs in a worker by default, so each call returns a promise ([Browser](/guide/browser/#runtime)). Node.js without a bundler resolves `cargo:` imports through the hooks `crossbind build -e node` writes ([Node.js](/guide/node/)).',
        },
        {
            type: 'p',
            text: 'Two crates may export the same name, as `semver::Version` and `uuid::Version` do. Import each from its `cargo:` module and rename with `as`; the module object `initNative()` resolves to carries prefixed spellings.',
        },
        { type: 'h3', text: 'One module at a time' },
        {
            type: 'p',
            text: 'A crate that keeps its API in modules is imported one public module at a time, with `/` between the crate and each module level. xxhash-rust exports nothing from its root:',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `// packages: { cargo: { 'xxhash-rust': '{ version = "0.8", features = ["xxh3"] }' } }
import { xxh364, Xxh3 } from 'cargo:xxhash-rust/xxh3';

const digest = xxh364(new TextEncoder().encode('crossbind'));`,
        },
        {
            type: 'p',
            text: "The module has to be public all the way from the crate root and switched on by the features you declare. A private module, one behind a feature you did not enable, or an inline `mod x { ... }` block fails the import with the module's name. Every import of one crate shares a single bridge, so a type reached through the root and through a module is the same JavaScript class.",
        },

        { type: 'h2', id: 'own-rs', text: 'Through your own .rs file' },
        {
            type: 'p',
            text: 'A declared crate is also a dependency of the `.rs` files under `src/native`, so you can write a small Rust surface of your own over it. That is the way to reach an API that does not bind as it is, such as one built on generics. [Rust](/guide/rust/#local-rs) covers those files.',
        },

        { type: 'h2', id: 'binding', text: 'What binds' },
        {
            type: 'p',
            text: "crossbind reads the crate's own sources: it follows `mod` trees and `pub use` re-exports, reads modules declared inside macros, and evaluates `#[cfg]` against the features you enabled. An item behind a disabled feature is not bound, and one that only some targets compile (`target_arch`, `target_os`) is left out everywhere, so one bridge builds on every platform.",
        },
        {
            type: 'p',
            text: 'Public structs with their `impl` blocks become classes, free functions become exports and a returned `Err` becomes an exception: the mapping, panics and the wasm stack follow the [Rust](/guide/rust/#mapping) page. A crate whose API is generic, or only re-exports other crates, may have nothing to bind; the build then warns that the import has no bindable surface.',
        },

        { type: 'h2', id: 'platforms', text: 'Where it builds' },
        {
            type: 'p',
            text: 'crossbind generates one bridge crate per declared crate under `.crossbind/rust-bridges/`, bundles them with your own `.rs` files into a single static library per target, and links that into the module. cargo is the incremental cache, so an unchanged crate rebuilds as a no-op. Crates download into `~/.crossbind/cargo`, a cargo home crossbind owns and every project shares.',
        },
        {
            type: 'ul',
            items: [
                'WebAssembly, wasm32, `st` and `mt`.',
                'React Native on Android and iOS.',
                'Node.js addons for macOS, Linux (glibc and musl) and Windows.',
            ],
        },

        { type: 'h2', id: 'lockfile', text: 'Versions and the lockfile' },
        {
            type: 'p',
            text: "The value becomes the crate's line in a generated `Cargo.toml`, so Cargo's rules apply: `'1'` accepts any 1.x release, and `features` and `default-features` work in the inline table.",
        },
        {
            type: 'p',
            text: 'The first build writes `crossbind.cargo.lock` next to `crossbind.config.js`. It pins the exact version of every crate the build links, the ones you declare and the ones they depend on, so commit it. Later builds follow it and add any crate it does not list yet; delete it to resolve every version again.',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: "Each `cargo:` import is typed by an ambient module, `declare module 'cargo:uuid'`, under `.crossbind/rust-crates/types/`, which `@crossbind/typescript-config` includes. A tsconfig that defines its own `include` replaces that list rather than adding to it, so keep the folder in yours:",
        },
        {
            type: 'code',
            file: 'tsconfig.json',
            code: `{
    "extends": "@crossbind/typescript-config",
    "include": ["src", ".crossbind/rust-crates/types/**/*.d.ts"]
}`,
        },
        {
            type: 'p',
            text: "For the browser's worker mode, set `dts: 'promise'` as described under [C++](/guide/bindings/#typescript).",
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                'No WASI builds: there is no `wasm32-wasip3` Rust target yet.',
                '`crossbind licenses` does not list the crates in `packages.cargo`.',
                'In React Native, Metro learns `cargo:<crate>/<module>` imports by scanning your sources when it starts, so a specifier assembled at run time is not found.',
            ],
        },
    ],
};

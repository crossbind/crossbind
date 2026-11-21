export default {
    slug: 'crates-io',
    title: 'crates.io',
    description: 'Import a Rust crate from crates.io into JavaScript with the cargo: scheme, without writing Rust.',
    lede: "Declare a crate in `crossbind.config.js` and import it with the `cargo:` prefix. crossbind reads the crate's sources and generates the bridge: you write no Rust and no glue.",
    blocks: [
        { type: 'h2', id: 'requirement', text: 'What you need' },
        {
            type: 'p',
            text: 'The same as for [Rust](/guide/rust/#setup): with the default Docker runner, you need Rust on your machine only for iOS and macOS builds. The first build of a crate needs the network to reach crates.io.',
        },

        { type: 'h2', id: 'declare', text: 'Declare the crate' },
        {
            type: 'p',
            text: 'List crates under `packages.cargo` in `crossbind.config.js` (`packages` is top level, next to `dependencies`). The key is the crate name; the value is what would follow `<crate> =` in a `Cargo.toml`, as a string: a version requirement or an inline table.',
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
            text: 'The prefix keeps a crate apart from an npm package of the same name, as `node:` does. One `initNative()` binds every module. Importing a crate that `packages.cargo` does not declare fails the build.',
        },
        {
            type: 'p',
            text: 'In a browser the module runs in a worker by default, so each call returns a promise ([Browser](/guide/browser/#runtime)). Node.js without a bundler resolves `cargo:` imports through the hooks `crossbind build -e node` writes ([Node.js](/guide/node/)).',
        },
        {
            type: 'p',
            text: 'Two crates may export the same name, as `semver::Version` and `uuid::Version` do. Import each from its `cargo:` module and rename with `as`; on the module object `initNative()` resolves to, they have prefixed names.',
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
            text: 'The module must be public all the way from the crate root and enabled by the features you declare; an inline `mod x { ... }` block cannot be imported. All imports of one crate share one bridge, so a type is the same JavaScript class whichever module you reach it through.',
        },

        { type: 'h2', id: 'own-rs', text: 'Through your own .rs file' },
        {
            type: 'p',
            text: 'A declared crate is also a dependency of your `.rs` files in `src/native`. Write a small Rust surface over it to reach an API that does not bind as it is, such as a generic one. See [Rust](/guide/rust/#local-rs).',
        },

        { type: 'h2', id: 'binding', text: 'What binds' },
        {
            type: 'p',
            text: "crossbind reads the crate's own sources with the features you enabled. An item behind a disabled feature does not bind, and one that only some targets compile (`target_arch`, `target_os`) is left out everywhere, so one bridge builds on every platform.",
        },
        {
            type: 'p',
            text: 'Types map as on the [Rust](/guide/rust/#mapping) page. A crate whose API is generic, or that only re-exports other crates, may have nothing to bind; the build then warns.',
        },

        { type: 'h2', id: 'platforms', text: 'Where it builds' },
        {
            type: 'p',
            text: 'Crates download into `~/.crossbind/cache/cargo`, which every project shares, and build for:',
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
            text: 'The first build writes `crossbind.cargo.lock` next to `crossbind.config.js`. It pins every crate the build links, dependencies included: commit it. Later builds follow it; delete it to resolve every version again.',
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
            text: "For worker mode, set `dts: 'promise'`; see [Runtime API](/guide/runtime-api/#types).",
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

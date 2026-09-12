// Why crossbind, and what it does not promise. Reused by the guide introduction and llms.txt
// so the three places (plus the README, which this mirrors) cannot drift apart. Every line is
// backed by the repository: the bullets by README.md "Why crossbind", the limits by the runtime
// constraints in AGENTS.md, the feature caveats in data.js and the current release notes.
export const WHY_POINTS = [
    ['Target-aware distribution', 'a package family carries WebAssembly, iOS, Android and WASI variants, and each build consumes only the artifact valid for its platform, architecture, runtime and build type.'],
    ['Native dependency resolution', 'package manifests and crossbind configs carry the transitive native graph, so prerequisites are built and linked in the right order.'],
    ['A reproducible package contract', 'port recipes record upstream versions, source integrity, licences, dependencies and target-specific artifacts.'],
    ['No hand-written binding glue', 'public functions, classes, methods, enums, containers and the supported standard-library types are generated from the header you already own.'],
    ['C++ and Rust', 'import local native sources, a `cargo:` crate or a reusable native package through the same project.'],
    ['First-party integrations and ports', 'bundler plugins give incremental builds, and version-pinned ports make GDAL, SQLite, OpenSSL, GEOS, PROJ and more available without rebuilding upstream.'],
];

export const LIMITS = [
    'Browser OPFS persistence requires `useWorker: true`; the OPFS API only exists in worker scope.',
    "Browser multithread builds (`runtime: 'mt'`) need COOP/COEP headers in production, and the pthread pool is capped at two workers.",
    'Edge runtimes such as Cloudflare Workers run single-threaded with an in-memory filesystem: no workers, no OPFS.',
    'Android builds link whole archives; dead-code elimination is not implemented there.',
    'iOS builds need a local Xcode and CocoaPods, Rust bindings need a local cargo, and WASI commands need wasmtime on PATH.',
    'There is no performance claim: a hand-written loop in JIT JavaScript can match the same algorithm in Wasm. The value is the libraries you would otherwise rewrite.',
    'The 2.0 line is a beta; prereleases carry no compatibility guarantee until the first stable train.',
];

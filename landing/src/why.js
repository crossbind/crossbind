// Why crossbind, and what it does not promise. Reused by the guide introduction and llms.txt
// so the three places (plus the README, which this mirrors) cannot drift apart. Every line is
// backed by the repository: the bullets by README.md "Why crossbind", the limits by the runtime
// constraints in AGENTS.md, the feature caveats in data.js and the current release notes.
export const WHY_POINTS = [
    ['Target-aware distribution', 'one package family carries WebAssembly, iOS, Android, desktop and WASI variants, and each build takes only the one for its target.'],
    ['Native dependency resolution', 'packages declare their native dependencies, so they are built and linked in the right order.'],
    ['A reproducible package contract', 'port recipes pin upstream versions, source hashes and licenses.'],
    ['No hand-written binding glue', 'functions, classes, enums, containers and standard-library types bind from the header you already have.'],
    ['C++ and Rust', 'import your own sources, a `cargo:` crate or a native package the same way.'],
    ['First-party integrations and ports', 'bundler plugins rebuild only what changed, and prebuilt ports bring GDAL, SQLite, OpenSSL, GEOS, PROJ and more.'],
];

export const LIMITS = [
    'Browser OPFS needs `useWorker: true`: browsers give synchronous file access only in workers.',
    "Browser multithread builds (`runtime: 'mt'`) need COOP/COEP headers in production. The thread pool has two workers by default; its size is configurable.",
    'Edge runtimes such as Cloudflare Workers run single-threaded with an in-memory filesystem: no workers, no OPFS.',
    'Android builds link whole archives: unused code is not dropped there.',
    'iOS and macOS builds need Xcode on a Mac, and iOS also CocoaPods. Rust for those platforms needs a local cargo. WASI commands need wasmtime on PATH.',
    'There is no performance claim: a hand-written loop in JIT JavaScript can match the same algorithm in Wasm. The value is the libraries you would otherwise rewrite.',
    'crossbind 2.0 is in beta: prereleases carry no compatibility guarantee until the first stable release.',
];

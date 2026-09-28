export default {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    description: 'The errors people actually hit, and the standard fix for each.',
    lede: 'Almost every common failure has a designated fix that does not involve editing generated artifacts. Read the error literally, work out which layer it belongs to - build, link, binding, runtime, hosting - and apply the least invasive fix that layer offers.',
    blocks: [
        { type: 'h2', id: 'build', text: 'Build errors' },
        { type: 'h3', text: 'ENOENT: no such file or directory … /dist/…' },
        {
            type: 'p',
            text: 'A dependency has not been built yet. Build the whole graph (`npm install && npm run build`) or build that dependency first - a filtered single-package build skips its dependencies.',
        },
        { type: 'h3', text: 'undefined symbol: <name>' },
        {
            type: 'ul',
            items: [
                '**A missing dependency.** The package providing the symbol is not in `dependencies` - add it to both `crossbind.config.js` and `package.json`.',
                '**A symbol clash.** Two libraries export the same name (classically `iconv`). Rename one set with a `replaceList` entry in `crossbind.build.js`, or drop the duplicate archive with `targetSpecs[].specs.ignoreLibName`.',
            ],
        },
        { type: 'h3', text: 'cannot find -l<libname>' },
        {
            type: 'p',
            text: 'The dependency built, but produced a different `.a` name than expected. Check `export.libName` in that package and confirm the file exists under its `dist/.../lib/`.',
        },
        { type: 'h3', text: 'CPU intrinsics that will not compile' },
        {
            type: 'p',
            text: 'Upstream code using `__asm__`, `CPL_CPUID` or `<immintrin.h>` has no wasm equivalent. Gate it behind `#ifdef __wasm__` through a `replaceList` entry:',
        },
        {
            type: 'code',
            file: 'crossbind.build.js',
            code: `replaceList: [{
    regex: /CPL_CPUID\\(1, cpuinfo\\);/g,
    replacement: '#ifdef __wasm__\\ncpuinfo[0]=0;\\n#else\\nCPL_CPUID(1, cpuinfo);\\n#endif',
    paths: ['port/cpl_cpu_features.cpp'],
}]`,
        },
        { type: 'h3', text: 'shared-memory is disallowed … not compiled with atomics' },
        {
            type: 'p',
            text: 'A multithreaded link pulled in a Rust archive built without the atomics features - almost always a stale cargo-type prebuilt. Rebuild that package\'s wasm output (after `rustup toolchain install nightly --component rust-src`), or update to a version whose `mt` prebuilt was produced that way.',
        },
        { type: 'h3', text: 'RuntimeError: index out of bounds during the build' },
        {
            type: 'p',
            text: 'Emscripten itself ran out of memory while linking. Raise it with `targetSpecs[].specs.binary.emccFlags: [\'-sINITIAL_MEMORY=512MB\']`.',
        },

        { type: 'h2', id: 'binding', text: 'Binding errors' },
        { type: 'h3', text: 'A function silently returns null or undefined' },
        {
            type: 'p',
            text: 'The C++ broke one of the [binding rules](/guide/bindings/#rules). In order of likelihood:',
        },
        {
            type: 'ul',
            items: [
                'Returning `unique_ptr` instead of `shared_ptr`.',
                'Returning a raw pointer - wrap it, or return by value.',
                'Multiple inheritance in the bound class.',
                'A template with no explicit instantiation.',
                'The definition lives only in the `.cpp`; the public surface has to be in the header.',
            ],
        },
        { type: 'h3', text: 'Tried to call … but the function is not exposed' },
        {
            type: 'p',
            text: 'The function is not on the public binding surface: an anonymous namespace, a file-scope `static`, or a declaration and definition that disagree on `static`/`inline`.',
        },

        { type: 'h2', id: 'runtime', text: 'Runtime errors' },
        {
            type: 'table',
            head: ['Message', 'Cause', 'Fix'],
            rows: [
                [
                    '`crossOriginIsolated is false`, `SharedArrayBuffer is not defined`',
                    'multithreaded build, production host not sending the isolation headers',
                    'add COOP/COEP - see [Threading](/guide/threading/#coop-coep)',
                ],
                [
                    '`OPFS is only available inside a Worker scope`',
                    'mounting `/opfs/...` from the main thread',
                    '`initNative({ useWorker: true })`',
                ],
                [
                    '`OPFS is disabled. Enable fs.opfs in config`',
                    '`fs: { opfs: false }` was set explicitly',
                    'remove it, or write under `/memfs/...`',
                ],
                [
                    '`RuntimeError: out of memory`',
                    'the wasm heap hit its ceiling',
                    'raise `-sINITIAL_MEMORY` / `-sMAXIMUM_MEMORY`, or stream the input instead of holding it all',
                ],
                [
                    '`m.someFunc is undefined`',
                    'a binding rule violation, or a call made before `await initNative(...)` resolved',
                    'check the rules first, then the ordering',
                ],
                [
                    '`instance.method is not a function`',
                    'a worker runtime: construction returned a promise',
                    '`const c = await new X(...)`, and set `dts: \'promise\'`',
                ],
            ],
        },
        {
            type: 'p',
            text: 'Memory growth is enabled by default, so an out-of-memory error usually means the design holds too much at once rather than that a limit is set too low.',
        },
        { type: 'h3', text: 'Calls hang forever with useWorker: true' },
        {
            type: 'p',
            text: 'Either the worker never spawned - check the Network tab for a request to the worker script - or the C++ inside it is in an infinite loop, which the Sources tab on the worker context will show.',
        },

        { type: 'h2', id: 'cross-cutting', text: 'Cross-cutting symptoms' },
        {
            type: 'ul',
            items: [
                '**`wasm streaming compile failed`.** Either the host serves `.wasm` as `application/octet-stream` instead of `application/wasm`, or `mt` and `st` artifacts got mixed - clean and rebuild after switching runtime.',
                '**The build succeeds but produces nothing.** Look for `Skipping target: ...` in the log: a `functions.isEnabled` override or a `target.platform` filter is excluding everything.',
                '**Hot reload ignores a `.cpp` change.** Restart the dev server, then verify `paths.native` resolves where you think it does - the plugins add exactly those files to the watcher.',
            ],
        },

        { type: 'h2', id: 'diagnostics', text: 'When nothing above matches' },
        {
            type: 'ol',
            items: [
                'Run the doctor script - most "weird" build failures are a missing toolchain (Node, Docker, Android SDK/NDK, Xcode).',
                'Rerun the `crossbind` command with `DEBUG=1`: a failure prints its full error, stack and cause chain, which usually names the failing step.',
                'Reduce to the smallest reproducer: a fresh project with only the failing dependency.',
                'Search the error text in the source - error messages are unique enough to find where they are thrown.',
                'File an issue when the error comes from the toolchain itself rather than from your configuration or the upstream library.',
            ],
        },
    ],
};

export default {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    description: 'The errors people actually hit, and the standard fix for each.',
    lede: 'Most failures have a standard fix that does not touch generated files. Read the error, find its layer (build, link, binding, runtime or hosting) and apply the smallest fix that layer offers.',
    blocks: [
        { type: 'h2', id: 'build', text: 'Build errors' },
        { type: 'h3', text: 'ENOENT: no such file or directory … /dist/…' },
        {
            type: 'p',
            text: 'A dependency is not built yet. Build the whole graph (`npm install && npm run build`), or that dependency first: a filtered build of one package skips its dependencies.',
        },
        { type: 'h3', text: 'undefined symbol: <name>' },
        {
            type: 'ul',
            items: [
                '**A missing dependency.** The package providing the symbol is not in `dependencies`: add it to both `crossbind.config.js` and `package.json`.',
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
            text: 'A multithreaded link pulled in a Rust archive built without atomics, almost always an old prebuilt of a Rust package. Rebuild that package\'s wasm output (after `rustup toolchain install nightly --component rust-src`), or update to a version whose `mt` prebuilt has them.',
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
            type: 'entries',
            items: [
                {
                    name: '`crossOriginIsolated is false`, `SharedArrayBuffer is not defined`',
                    text: 'A multithreaded build on a host that does not send the isolation headers. Add COOP/COEP; see [Threads and workers](/guide/threading/#coop-coep).',
                },
                { name: '`OPFS is only available inside a Worker scope`', text: 'Mounting `/opfs/...` on the page thread. Use `initNative({ useWorker: true })`.' },
                {
                    name: '`OPFS is disabled. Enable fs.opfs in config`',
                    text: 'OPFS is off: the default in `st` builds, or `fs: { opfs: false }`. Turn it on with `fs: { opfs: true }`, or write under `/memfs/...`.',
                },
                {
                    name: '`RuntimeError: out of memory`',
                    text: 'The wasm heap hit its ceiling. Raise `-sINITIAL_MEMORY` or `-sMAXIMUM_MEMORY`, or stream the input instead of holding it all. Memory grows by default, so this usually means the design holds too much at once.',
                },
                { name: '`m.someFunc is undefined`', text: 'A [binding rule](/guide/bindings/#rules) is broken, or the call came before `initNative()` resolved. Check the rules first, then the order.' },
                { name: '`instance.method is not a function`', text: "In worker mode, construction returned a promise. Write `const c = await new X(...)`, and set `dts: 'promise'`." },
            ],
        },
        { type: 'h3', text: 'Calls hang forever with useWorker: true' },
        {
            type: 'p',
            text: 'Either the worker never started (check the Network tab for the worker script), or the C++ in it is stuck in a loop (the Sources tab shows the worker).',
        },

        { type: 'h2', id: 'cross-cutting', text: 'Cross-cutting symptoms' },
        {
            type: 'ul',
            items: [
                '**The streaming compile fails.** `wasm streaming compile failed` means either the host serves `.wasm` as `application/octet-stream` instead of `application/wasm`, or `mt` and `st` builds got mixed: clean and rebuild after switching.',
                '**The build succeeds but produces nothing.** Look for `Skipping target: ...` in the log: a `functions.isEnabled` override or a `target.platform` filter is excluding everything.',
                '**Hot reload ignores a C++ change.** Restart the dev server, then check where `paths.native` points: the plugins watch exactly those files.',
            ],
        },

        { type: 'h2', id: 'diagnostics', text: 'When nothing above matches' },
        {
            type: 'ol',
            items: [
                'Check the [prerequisites](/guide/quick-start/#prerequisites): most odd build failures are a missing tool.',
                'Rerun the `crossbind` command with `DEBUG=1`: a failure prints its full error, stack and cause chain, which usually names the failing step.',
                'Reduce to the smallest reproducer: a fresh project with only the failing dependency.',
                'Search the error text in the source - error messages are unique enough to find where they are thrown.',
                'File an issue when the error comes from the toolchain itself rather than from your configuration or the upstream library.',
            ],
        },
    ],
};

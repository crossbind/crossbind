// Assembles the lib section of the emcc link line. --whole-archive is applied
// only where symbol retention genuinely needs it: always the Bridge archive
// (its embind registrations live in static initializers that no symbol
// references), plus any archive opted in via config - `wholeArchive: true` on
// the project (legacy everything-wholesale layout) or on a dependency's own
// config, or names listed in the project's `wholeArchiveDependencies`.
// Everything else links normally so wasm-ld keeps just the referenced call
// graph instead of every archive member.

export function libNameOf(libPath) {
    const base = libPath.split('/').pop();
    const match = /^lib(.+)\.a$/.exec(base);
    return match ? match[1] : base;
}

export function buildLinkLibArgs(libs, {
    wholeArchiveAll = false, wholeArchiveNames = new Set(), wrapLast = true, forceLoad = false,
} = {}) {
    const args = [];
    let wrapped = false;
    libs.forEach((lib, index) => {
        // wrapLast covers the Bridge archive convention; wasi command links
        // have no bridge (main() is the GC root), so they pass false.
        const isBridge = wrapLast && index === libs.length - 1;
        const wantWrap = wholeArchiveAll || isBridge || wholeArchiveNames.has(libNameOf(lib));
        // Apple's ld64 has no --whole-archive groups; it keeps archives one at a time.
        if (forceLoad) {
            args.push(wantWrap ? `-Wl,-force_load,${lib}` : lib);
            return;
        }
        if (wantWrap !== wrapped) {
            args.push(wantWrap ? '-Wl,--whole-archive' : '-Wl,--no-whole-archive');
            wrapped = wantWrap;
        }
        args.push(lib);
    });
    if (wrapped) {
        args.push('-Wl,--no-whole-archive');
    }
    return args;
}

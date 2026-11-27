import path from 'node:path';

const NAME = 'crossbind';
// What the plugin turns into a module.
const LOADED = ['header', 'module', 'rust'];

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const endingIn = (extensions) => `\\.(${extensions.map(escaped).join('|')})$`;

// crossbind's plugin for esbuild and Bun, on the api crossbind() hands it: Bun's builds take the same setup(build).
export default function esbuildPlugin(api) {
    return {
        name: NAME,
        async setup(build) {
            await api.ready();
            // The web build, which a project without one stops at here.
            const { release } = api.targets;
            const options = build.initialOptions;
            // Where the page loads the glue from: the URL the build's outputs are served at.
            const base = options.publicPath ? options.publicPath.replace(/\/?$/, '/') : '/';
            const outdir = options.outdir ?? (options.outfile ? path.dirname(options.outfile) : null);
            const rustEntries = new Map(api.rustPackages().map(({ name, entry }) => [name, entry]));
            const { header, module } = api.ext;
            // A dependency's header (`@crossbind/port-zlib/zlib.h`) names the package, not a file, as a `cargo:` import
            // names a crate; a Rust package ships no JS entry, so its name becomes its crate root.
            const named = new RegExp(['^cargo:', endingIn(header), ...[...rustEntries.keys()].map((name) => `^${escaped(name)}$`)].join('|'));
            // Before any build: Bun starts its first build before an async setup settles.
            await api.prepare(release);

            build.onStart(() => api.prepare(release));
            build.onResolve({ filter: named }, ({ path: request }) => {
                const file = rustEntries.get(request) ?? api.resolve(request, release);
                return file ? { path: file } : undefined;
            });
            build.onLoad({ filter: new RegExp(endingIn([...header, ...module, 'rs'])) }, ({ path: file }) => {
                const kind = api.kindOf(file);
                if (!LOADED.includes(kind)) return undefined;
                const contents = api.transform(file, release, { base });
                if (contents === null) return undefined;
                // The names the app imports decide what a header binds, so watch mode loads it again after any source
                // edit, and a native source's edit relinks the wasm.
                const watchFiles = [...(kind === 'rust' ? [] : api.appSources()), ...api.nativeFiles()];
                return { contents, loader: 'js', resolveDir: path.dirname(file), watchFiles };
            });
            build.onEnd(async (result) => {
                if (result.errors?.length || result.success === false) return;
                await api.link(release);
                // crossbind.config.js may name where the page's files go; else they go beside the build's.
                const dir = api.dirs.output ?? outdir;
                if (dir) api.writeOutputs(release, dir);
            });
        },
    };
}

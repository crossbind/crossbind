import fs from 'node:fs';
import p from 'node:path';

// crossbind's Rollup plugin, which Vite runs too, on the api crossbind() hands it.
export default function rollupPlugin(api) {
    // The page's build: wasm for a browser, or in an app build the app's host. A project without one stops at it.
    let release = null;
    const ready = async () => {
        if (!release) {
            await api.ready();
            release = api.targets.release;
        }
        return release;
    };
    // Vite gives the base it serves the app from; plain Rollup has none.
    let base = '/';
    // What the names of the files Vite's assets came from are relative to.
    let root = process.cwd();
    let isServe = false;

    function emitOutputs(context) {
        api.outputs(release).forEach(({ name, path, optional }) => {
            if (optional && !fs.existsSync(path)) return;
            context.emitFile({ type: 'asset', source: fs.readFileSync(path), fileName: name });
        });
    }

    // A page that reads its licenses with crossbind/licenses finds them beside it.
    async function emitLicenses(context, bundle) {
        const asset = await api.licenses(bundle, { root });
        if (asset) context.emitFile({ type: 'asset', ...asset });
    }

    return {
        name: 'rollup-plugin-crossbind',
        configResolved(config) {
            base = config.base;
            root = config.root;
            isServe = config.command === 'serve';
        },
        async resolveId(source) {
            if (source === '/crossbind.js') {
                return { id: source, external: true };
            }
            await ready();
            if (source === 'crossbind/app') {
                const pageApi = api.pageApi();
                if (pageApi) return pageApi;
            }
            return api.resolve(source, release);
        },
        async transform(code, path) {
            await ready();
            const module = api.transform(path, release, { base });
            if (module === null) return null;
            // The names the app imports decide what a header binds, so watch mode transforms it again after any source edit.
            // Vite's dev server rebinds them itself: there, Vite would take the sources for imports of the header and, the
            // page importing the header, update nothing after an edit to the page.
            if (!isServe && api.kindOf(path) !== 'rust') api.appSources().forEach((file) => this.addWatchFile(file));
            return module;
        },
        async buildStart() {
            await ready();
            // writeBundle puts each app beside what installs it, whose names, signing keys and installers stop the build
            // here if they cannot be, before the dependencies compile.
            if (api.app && !isServe) await api.app.check();
            await api.prepare(release);
            api.nativeFiles().forEach((file) => this.addWatchFile(file));
        },
        async generateBundle(_, bundle) {
            await ready();
            if (api.app) await api.app.build();
            else await api.link(release);
            emitOutputs(this);
            await emitLicenses(this, bundle);
        },
        async writeBundle(outputOptions) {
            await ready();
            if (!api.app) return;
            await api.app.publish(outputOptions.dir ?? p.dirname(outputOptions.file));
        },
    };
}

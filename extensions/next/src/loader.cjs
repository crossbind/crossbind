// crossbind's loader under Next.js, Turbopack's or webpack's: Turbopack runs loaders in processes of its own with options
// that are plain data, so this makes an api of its own from the module crossbind(config) names, as Metro's workers do.
let api = null;
const apiOf = (workerModule) => {
    api ??= import(workerModule).then(({ default: integrationApi }) => integrationApi());
    return api;
};

module.exports = async function crossbindLoader() {
    const { workerModule, base } = this.getOptions();
    const crossbind = await apiOf(workerModule);
    // A dependency's header binds from its release build, which a debug link reads too. The glue is at the base, under
    // /_next/static after `next build` and at crossbind's own server under `next dev`, not at webpack's public path.
    const module = crossbind.transform(this.resourcePath, crossbind.targets.release, { base, atBase: true });
    // The names the app imports decide what a header binds, so a dev server loads it again after any source edit, and a
    // native source's edit changes the module the glue links.
    if (crossbind.kindOf(this.resourcePath) !== 'rust') crossbind.appSources().forEach((file) => this.addDependency(file));
    crossbind.nativeFiles().forEach((file) => this.addDependency(file));
    return module;
};

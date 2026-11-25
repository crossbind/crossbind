// crossbind's loader: the module of a header or a Rust file, which the api crossbind() handed the plugin makes.
async function crossbindLoader() {
    const { api } = this.getOptions();
    await api.ready();
    const module = api.transform(this.resourcePath, api.targets.release);
    // The names the app imports decide what a header binds, so watch mode loads it again after any source edit.
    if (api.kindOf(this.resourcePath) !== 'rust') api.appSources().forEach((file) => this.addDependency(file));
    return module;
}

module.exports = crossbindLoader;

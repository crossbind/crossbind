async function crossbindLoader() {
    const { api } = this.getOptions();
    const module = api.transform(this.resourcePath, api.targets.release);
    // The names the app imports decide what a header binds, so watch mode loads it again after any source edit.
    if (api.kindOf(this.resourcePath) !== 'rust') api.appSources().forEach((file) => this.addDependency(file));
    return module;
}

module.exports = crossbindLoader;

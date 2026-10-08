async function crossbindLoader() {
    const {
        bridges, appSourceFiles, createBridgeFile, getCrossbindScript, getRustJsScript, state,
    } = this.getOptions();
    const target = state.targets.find((t) => t.platform === 'wasm');

    // Rust surfaces need no C++ bridge file: the native bridge is the generated companion
    // crate; this only emits the JS proxy module - the same shape as the .h flow.
    if (this.resourcePath.endsWith('.rs')) {
        return getRustJsScript(target, this.resourcePath);
    }

    const bridgeFile = createBridgeFile(this.resourcePath);
    // A header loads again after each source edit; a repeated entry would change the bridge lib's fingerprint.
    if (!bridges.includes(bridgeFile)) bridges.push(bridgeFile);
    // The names the app imports decide what a header binds, so watch mode loads it again after any source edit.
    appSourceFiles(state.config.paths.project).forEach((file) => this.addDependency(file));

    return getCrossbindScript(target, bridgeFile);
}

module.exports = crossbindLoader;

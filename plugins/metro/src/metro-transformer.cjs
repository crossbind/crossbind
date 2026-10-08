 
const path = require('node:path');
const { getWebTargets, requireWebTargets } = require('./web.cjs');

const upstreamTransformer = (() => {
    try {
        return require('@expo/metro-config/babel-transformer');
    } catch (error) {
        try {
            return require('@react-native/metro-babel-transformer');
        } catch (e) {
            return require('metro-react-native-babel-transformer');
        }
    }
})();

let compilerClassPromise;
const getCompilerClass = () => {
    if (compilerClassPromise) return compilerClassPromise;
    compilerClassPromise = new Promise((resolve, reject) => {
        import('crossbind').then(({
            state, getCrossbindScript, getRustJsScript, createBridgeFile, getTargetParams, getFilteredBuildTargets, bindHeaderImports,
        }) => {
            resolve({
                state, getCrossbindScript, getRustJsScript, createBridgeFile, getTargetParams, getFilteredBuildTargets, bindHeaderImports,
            });
        }).catch((e) => reject(e));
    });
    return compilerClassPromise;
};

module.exports.transform = async ({ src, filename, ...rest }) => {
    const crossbind = await getCompilerClass();
    const { state, getCrossbindScript, getRustJsScript, createBridgeFile } = crossbind;
    const file = path.resolve(rest.options.projectRoot ?? '', filename);
    const headerRegex = new RegExp(`\\.(${state.config.ext.header.join('|')})$`);
    const moduleRegex = new RegExp(`\\.(${state.config.ext.module.join('|')})$`);
    if (headerRegex.test(filename) || moduleRegex.test(filename) || filename.endsWith('.rs')) {
        let target;
        if (rest.options.platform === 'ios') target = state.targets.find((t) => t.platform === 'ios');
        else if (rest.options.platform === 'android') target = state.targets.find((t) => t.platform === 'android');
        else target = requireWebTargets(crossbind).release;
        // Expo serves a web app under experiments.baseUrl, and the boot code asks for its wasm there.
        const base = `${rest.options.customTransformOptions?.baseUrl ?? ''}/`;

        // Rust surfaces need no bridge file here: the native bridge is the package's generated
        // companion crate; this only emits the JS proxy module (same shape as the .h flow).
        if (filename.endsWith('.rs')) {
            return upstreamTransformer.transform({ src: getRustJsScript(target, filename, { base }), filename, ...rest });
        }

        const bridgeFile = createBridgeFile(file, target);

        // Only a dev server keeps a header's module while the app's imports change: Xcode and Gradle bundle a release
        // from a cleared cache.
        return upstreamTransformer.transform({ src: getCrossbindScript(target, bridgeFile, { base, liveExports: rest.options.dev }), filename, ...rest });
    }

    const appTarget = ['ios', 'android'].includes(rest.options.platform)
        ? state.targets.find((t) => t.platform === rest.options.platform)
        : getWebTargets(crossbind)?.release;
    if (appTarget) crossbind.bindHeaderImports(src, file, appTarget);

    return upstreamTransformer.transform({ src, filename, ...rest });
};

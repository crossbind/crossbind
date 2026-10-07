 
const { requireWebTargets } = require('./web.cjs');

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
            state, getCrossbindScript, getRustJsScript, createBridgeFile, getTargetParams, getFilteredBuildTargets,
        }) => {
            resolve({
                state, getCrossbindScript, getRustJsScript, createBridgeFile, getTargetParams, getFilteredBuildTargets,
            });
        }).catch((e) => reject(e));
    });
    return compilerClassPromise;
};

module.exports.transform = async ({ src, filename, ...rest }) => {
    const crossbind = await getCompilerClass();
    const { state, getCrossbindScript, getRustJsScript, createBridgeFile } = crossbind;
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

        const bridgeFile = createBridgeFile(filename, target);

        return upstreamTransformer.transform({ src: getCrossbindScript(target, bridgeFile, { base }), filename, ...rest });
    }

    return upstreamTransformer.transform({ src, filename, ...rest });
};

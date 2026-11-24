const path = require('node:path');

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

let apiPromise;
const getApi = () => {
    apiPromise ??= import('crossbind').then(({ integrationApi }) => integrationApi());
    return apiPromise;
};

const NATIVE_KINDS = ['header', 'module', 'rust'];
const isReactNative = (platform) => platform === 'ios' || platform === 'android';

module.exports.transform = async ({ src, filename, ...rest }) => {
    const api = await getApi();
    const { platform } = rest.options;
    const file = path.resolve(rest.options.projectRoot ?? '', filename);
    if (NATIVE_KINDS.includes(api.kindOf(filename))) {
        const target = isReactNative(platform) ? api.nativeTarget(platform) : api.targets.release;
        // Expo serves a web app under experiments.baseUrl, and the boot code asks for its wasm there. Only a dev server
        // keeps a header's module while the app's imports change: Xcode and Gradle bundle a release from a cleared cache.
        const base = `${rest.options.customTransformOptions?.baseUrl ?? ''}/`;
        const code = api.transform(file, target, { base, liveExports: rest.options.dev });
        return upstreamTransformer.transform({ src: code, filename, ...rest });
    }

    const appTarget = isReactNative(platform) ? api.nativeTarget(platform) : api.web?.release;
    if (appTarget) api.bindImports(src, file, appTarget);

    return upstreamTransformer.transform({ src, filename, ...rest });
};

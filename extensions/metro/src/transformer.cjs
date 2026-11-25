const path = require('node:path');

// What crossbind(config) tells Metro's workers, which share no memory with the config's process: the module that makes
// an api, and the transformer the config had, which gets every file once crossbind has turned its own into modules.
const WORKER_ENV = 'CROSSBIND_METRO';

let worker = null;
function workerOf() {
    if (!worker) {
        const { api, upstream } = JSON.parse(process.env[WORKER_ENV] ?? 'null') ?? {};
        if (!api || !upstream) throw new Error('crossbind: this transformer runs through crossbind(config) in metro.config.js alone.');
        worker = { upstream: require(upstream), api: import(api).then(({ default: integrationApi }) => integrationApi()) };
    }
    return worker;
}

const NATIVE_KINDS = ['header', 'module', 'rust'];
const isReactNative = (platform) => platform === 'ios' || platform === 'android';

async function transform({ src, filename, ...rest }) {
    const { upstream } = workerOf();
    const api = await workerOf().api;
    const { platform } = rest.options;
    const file = path.resolve(rest.options.projectRoot ?? '', filename);
    if (NATIVE_KINDS.includes(api.kindOf(filename))) {
        const target = isReactNative(platform) ? api.nativeTarget(platform) : api.targets.release;
        // Expo serves a web app under experiments.baseUrl, and the boot code asks for its wasm there. Only a dev server
        // keeps a header's module while the app's imports change: Xcode and Gradle bundle a release from a cleared cache.
        const base = `${rest.options.customTransformOptions?.baseUrl ?? ''}/`;
        const code = api.transform(file, target, { base, liveExports: rest.options.dev });
        return upstream.transform({ src: code, filename, ...rest });
    }

    const appTarget = isReactNative(platform) ? api.nativeTarget(platform) : api.web?.release;
    if (appTarget) api.bindImports(src, file, appTarget);

    return upstream.transform({ src, filename, ...rest });
}

module.exports = { WORKER_ENV, transform };

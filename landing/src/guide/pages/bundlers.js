export default {
    slug: 'bundlers',
    title: 'Bundlers',
    description: 'Vite, Webpack, Rspack, Rollup, Metro - and the escape hatch when you have none.',
    lede: 'A bundler plugin is what makes the header import work: it resolves `.h` imports, generates the bridge, compiles on demand in dev, and emits the wasm next to your bundle. Pick the one matching your build, or skip the plugin entirely and compile straight from the CLI.',
    blocks: [
        { type: 'h2', id: 'which', text: 'Which plugin' },
        {
            type: 'table',
            head: ['Build tool', 'Install', 'Registered in'],
            rows: [
                ['Vite', '`@crossbind/plugin-vite`', '`vite.config.js`'],
                ['Rollup', '`@crossbind/plugin-rollup`', '`rollup.config.js`'],
                ['Webpack', '`@crossbind/plugin-webpack` + `@crossbind/plugin-webpack-loader`', '`webpack.config.js`'],
                ['Rspack', '`@crossbind/plugin-webpack` + `@crossbind/plugin-webpack-loader`', '`rspack.config.mjs`'],
                ['Metro (React Native)', '`@crossbind/plugin-react-native` + `@crossbind/plugin-metro`', '`metro.config.js`'],
                ['None', '`crossbind`', 'a `build` script - see [standalone](#standalone)'],
            ],
        },
        {
            type: 'p',
            text: 'Whichever you pick, the project also needs a `crossbind.config.js` at its root. The minimal one only sets `paths.config`; see [Configuration](/guide/configuration/).',
        },

        { type: 'h2', id: 'vite', text: 'Vite' },
        { type: 'code', file: 'shell', code: 'npm install -D @crossbind/plugin-vite' },
        {
            type: 'code',
            file: 'vite.config.js',
            code: `import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({
    plugins: [viteCrossbindPlugin()],
});`,
        },
        {
            type: 'p',
            text: 'The Vite plugin injects COOP/COEP headers for `vite dev` and `vite preview`, so multithreaded builds work in development with no extra setup. Production hosting is your own - see [Threading](/guide/threading/).',
        },

        { type: 'h2', id: 'rollup', text: 'Rollup' },
        {
            type: 'p',
            text: 'The Rollup plugin is the kernel the Vite one wraps. Use it directly when you build with plain Rollup; on Vite, use the Vite plugin instead.',
        },
        { type: 'code', file: 'shell', code: 'npm install -D @crossbind/plugin-rollup' },
        {
            type: 'code',
            file: 'rollup.config.js',
            code: `import rollupCrossbindPlugin from '@crossbind/plugin-rollup';

export default {
    plugins: [rollupCrossbindPlugin()],
};`,
        },

        { type: 'h2', id: 'webpack', text: 'Webpack' },
        { type: 'code', file: 'shell', code: 'npm install -D @crossbind/plugin-webpack @crossbind/plugin-webpack-loader' },
        {
            type: 'code',
            file: 'webpack.config.js',
            code: `const CrossbindWebpackPlugin = require('@crossbind/plugin-webpack');

const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

module.exports = {
    plugins: [crossbindWebpackPlugin],
    module: {
        rules: [crossbindWebpackPlugin.getRule()],
    },
    devServer: crossbindWebpackPlugin.getDevServerConfig(),
};`,
        },
        {
            type: 'p',
            text: '`getDevServerConfig()` is what carries the COOP/COEP headers in dev; keep it if you build multithreaded.',
        },

        { type: 'h2', id: 'rspack', text: 'Rspack' },
        {
            type: 'p',
            text: 'Rspack uses the same two packages as Webpack, registered in ESM form.',
        },
        {
            type: 'code',
            file: 'rspack.config.mjs',
            code: `import CrossbindWebpackPlugin from '@crossbind/plugin-webpack';

const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

export default defineConfig({
    module: {
        rules: [crossbindWebpackPlugin.getRule()],
    },
    plugins: [crossbindWebpackPlugin],
    devServer: crossbindWebpackPlugin.getDevServerConfig(),
});`,
        },

        { type: 'h2', id: 'metro', text: 'Metro (React Native)' },
        {
            type: 'p',
            text: 'React Native compiles to native libraries rather than wasm, so it needs the autolinked runtime packages plus the Metro plugin that runs while bundling.',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install @crossbind/plugin-react-native @crossbind/plugin-react-native-ios-helper
npm install -D @crossbind/plugin-metro`,
        },
        {
            type: 'code',
            file: 'metro.config.js',
            code: `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const CrossbindMetroPlugin = require('@crossbind/plugin-metro/metro-plugin.cjs');

const config = {
    ...CrossbindMetroPlugin(getDefaultConfig(__dirname)),
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Do not add crossbind itself',
            text: '`@crossbind/plugin-react-native` brings the toolchain it was built against. A second pin in your `package.json` can drift from it.',
        },
        {
            type: 'p',
            text: 'Expo needs one more step (`expo prebuild` plus the config plugin in `app.json`) - see [Runtimes](/guide/runtimes/#react-native).',
        },

        { type: 'h2', id: 'standalone', text: 'No bundler' },
        {
            type: 'p',
            text: 'Without a bundler you compile with the CLI and import the generated loader yourself. Add `crossbind` as a dev dependency and a build script:',
        },
        {
            type: 'code',
            file: 'package.json',
            code: `{
    "scripts": {
        "build": "crossbind build -p wasm -a wasm32 -r st -e browser -b release"
    },
    "devDependencies": {
        "crossbind": "^2.0.0-beta"
    }
}`,
        },
        {
            type: 'p',
            text: 'The build writes `<name>-wasm-wasm32-st-release.browser.js` and its `.wasm` into the folder named by `paths.output`. Load the JS file and call the global boot function:',
        },
        {
            type: 'code',
            file: 'index.html',
            code: `<script src="./dist/myapp-wasm-wasm32-st-release.browser.js"></script>
<script>
    initNative({ path: './dist' }).then(({ MySampleClass }) => {
        document.querySelector('#cppMessage').innerHTML = MySampleClass.sample();
    });
</script>`,
        },
        {
            type: 'p',
            text: 'You lose dev-mode recompiles and dead-code elimination against your app code; everything else works the same.',
        },

        { type: 'h2', id: 'own-plugin', text: 'Writing your own plugin' },
        {
            type: 'p',
            text: 'The contract is small enough to port to another build tool: resolve header imports to bridge files (`resolveId` / `load`), generate a bridge per header and hand back the loader (`createBridgeFile`, `getCrossbindScript`), compile in the bundle step (`createLib`, `buildWasm`), and in dev serve `/crossbind` and `/crossbind.wasm` from the build directory while watching `paths.native` and the app\'s own sources (`appSourceFiles`) for changes: the names the app imports decide which functions of a dependency\'s header bind.',
        },
        {
            type: 'code',
            file: 'my-plugin.js',
            code: `import {
    state, createLib, createBridgeFile, buildWasm, getCrossbindScript,
    getDependFilePath, getTargetParams, getFilteredBuildTargets,
} from 'crossbind';

const targetParams = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
const target = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];`,
        },
        {
            type: 'p',
            text: 'Every helper takes that resolved target object, which also carries the output names (`jsName`, `wasmName`, `dataTxtName`). Mirror `@crossbind/plugin-rollup` - it is the smallest complete implementation.',
        },
    ],
};

import { installCommand } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const WEBPACK_INSTALL = `npm install -D @crossbind/plugin-webpack${suffix} @crossbind/plugin-webpack-loader${suffix}`;
const WEBPACK_PACKAGES = '`@crossbind/plugin-webpack` and `@crossbind/plugin-webpack-loader`';

export default {
    slug: 'bundler-plugins',
    title: 'Bundler plugins',
    description: 'The Vite, Webpack, Rspack, Rollup and Metro plugins: which one a project takes, how to register it, and the functions to write your own.',
    lede: "A bundler plugin turns each header and `.rs` file you import into a JavaScript module. For the web it also compiles the wasm while you develop and emits it with your bundle; in a React Native app, the app's Xcode and Gradle builds compile the native code.",
    blocks: [
        { type: 'h2', id: 'which', text: 'Which plugin' },
        {
            type: 'table',
            head: ['Bundler', 'Package', 'Builds for'],
            rows: [
                ['[Vite](#vite)', '`@crossbind/plugin-vite`', '[Browser](/guide/browser/) and [Apps](/guide/apps/)'],
                ['[Webpack](#webpack)', WEBPACK_PACKAGES, 'Browser'],
                ['[Rspack](#rspack)', WEBPACK_PACKAGES, 'Browser'],
                ['[Rollup](#rollup)', '`@crossbind/plugin-rollup`', 'Browser'],
                ['[Metro](#metro)', '`@crossbind/plugin-metro` and `@crossbind/plugin-react-native`', "[React Native](/guide/react-native/), and Expo's web build"],
            ],
        },
        {
            type: 'p',
            text: "Each one reads the project's `crossbind.config.js`, or `crossbind.config.mjs`, from the folder the bundler runs in. A page with no bundler builds with the CLI instead: see [No bundler](/guide/browser/#no-bundler).",
        },

        { type: 'h2', id: 'vite', text: 'Vite' },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/plugin-vite') },
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
            text: 'The plugin sits next to your framework\'s plugin; React, Vue and Svelte need nothing more.',
        },

        { type: 'h2', id: 'webpack', text: 'Webpack' },
        { type: 'code', file: 'shell', code: WEBPACK_INSTALL },
        {
            type: 'code',
            file: 'webpack.config.mjs',
            code: `import CrossbindWebpackPlugin from '@crossbind/plugin-webpack';

const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

export default {
    module: {
        rules: [crossbindWebpackPlugin.getRule()],
    },
    plugins: [crossbindWebpackPlugin],
    devServer: crossbindWebpackPlugin.getDevServerConfig(),
};`,
        },
        {
            type: 'p',
            text: '`getRule()` hands headers and `.rs` files to the loader package, which is why both are installed. `getDevServerConfig()` serves the compiled module in dev and sends the COOP/COEP headers; if you already have a `devServer` block, spread it in and keep its `headers` and `setupMiddlewares`.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Keep the config an ES module',
            text: 'crossbind loads your project config with a top-level `await`, and Node cannot `require()` a module that does: a CommonJS `webpack.config.js` that requires the plugin fails with `ERR_REQUIRE_ASYNC_MODULE`. Name it `webpack.config.mjs`, or set `"type": "module"`.',
        },

        { type: 'h2', id: 'rspack', text: 'Rspack' },
        {
            type: 'p',
            text: 'Rspack takes the same two packages through its webpack-compatible plugin API.',
        },
        { type: 'code', file: 'shell', code: WEBPACK_INSTALL },
        {
            type: 'code',
            file: 'rspack.config.mjs',
            code: `import { defineConfig } from '@rspack/cli';
import CrossbindWebpackPlugin from '@crossbind/plugin-webpack';

const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

export default defineConfig({
    module: {
        rules: [crossbindWebpackPlugin.getRule()],
    },
    plugins: [crossbindWebpackPlugin],
    devServer: crossbindWebpackPlugin.getDevServerConfig(),
});`,
        },

        { type: 'h2', id: 'rollup', text: 'Rollup' },
        {
            type: 'p',
            text: 'The Rollup plugin is the core the Vite plugin wraps; use it directly only for a plain Rollup build. Rollup has no dev server: `rollup -c -w` rebuilds the wasm when a native file changes, and nothing reloads a page.',
        },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/plugin-rollup') },
        {
            type: 'code',
            file: 'rollup.config.mjs',
            code: `import rollupCrossbindPlugin from '@crossbind/plugin-rollup';

export default {
    input: 'src/index.js',
    output: { file: 'dist/index.js', format: 'esm' },
    plugins: [rollupCrossbindPlugin()],
};`,
        },
        {
            type: 'p',
            text: 'The bundle step writes `crossbind.js` and `crossbind.wasm` into the output directory. Plain Rollup has no base path, so the generated code loads them from the site root.',
        },

        { type: 'h2', id: 'metro', text: 'Metro' },
        {
            type: 'p',
            text: '`@crossbind/plugin-metro` turns header, `.i` and `.rs` imports into modules and writes the C++ bridge for each header while Metro bundles a React Native or Expo app; on iOS and Android the app\'s Xcode and Gradle builds compile the C++, through `@crossbind/plugin-react-native`. [React Native](/guide/react-native/#metro) shows its config, and [Expo](/guide/react-native/#expo) the web build it makes as well.',
        },

        { type: 'h2', id: 'own-plugin', text: 'Another bundler' },
        {
            type: 'p',
            text: 'The plugins are thin: the work is done by functions `crossbind` exports, and `@crossbind/plugin-rollup` is the smallest complete plugin to copy. Each one starts by picking the browser target:',
        },
        {
            type: 'code',
            file: 'my-plugin.js',
            code: `import {
    state, buildDependencies, createBridgeFile, getCrossbindScript, getDependFilePath,
    createLib, buildWasm, appSourceFiles, getTargetParams, getFilteredBuildTargets,
} from 'crossbind';

const targetParams = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
const target = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];`,
        },
        {
            type: 'ul',
            items: [
                'Before the first transform, `buildDependencies()` puts the library headers in place.',
                'Imported headers become modules through `createBridgeFile()` and `getCrossbindScript()`; a library header such as `@crossbind/port-zlib/zlib.h` resolves through `getDependFilePath()`.',
                'The bundle step compiles with `createLib()` and `buildWasm()` and emits the target\'s `jsName`, `wasmName` and `dataTxtName` from `state.config.paths.build` as `crossbind.js`, `crossbind.wasm` and `crossbind.data.txt`.',
                'In dev, the plugin serves those files and watches `state.config.paths.native` and `appSourceFiles()`, whose imports decide what a library header binds.',
            ],
        },
    ],
};

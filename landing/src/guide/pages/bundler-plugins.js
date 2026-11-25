import { REPO_URL, installCommand } from '../../data.js';

const INTEGRATIONS_URL = `${REPO_URL}/blob/main/docs/api/extensions.md#integrations`;

export default {
    slug: 'bundler-plugins',
    title: 'Bundler plugins',
    description: "One plugin for every tool, crossbind(): in Vite's, Webpack's, Rspack's and Rollup's plugin lists, around Metro's config, and how another tool joins.",
    lede: "One plugin serves every tool: `crossbind()`. It turns each header and `.rs` file you import into a JavaScript module. For the web it also compiles the wasm while you develop and emits it with your bundle; in a React Native app, the app's Xcode and Gradle builds compile the native code.",
    blocks: [
        { type: 'h2', id: 'which', text: 'What each tool takes' },
        { type: 'code', file: 'shell', code: installCommand('crossbind') },
        {
            type: 'table',
            head: ['Tool', 'Where `crossbind()` goes', 'Builds for'],
            rows: [
                ['[Vite](#vite)', '`plugins: [crossbind()]`', '[Browser](/guide/browser/) and [Apps](/guide/apps/)'],
                ['[Webpack](#webpack)', '`plugins: [crossbind()]`', 'Browser'],
                ['[Rspack](#rspack)', '`plugins: [crossbind()]`', 'Browser'],
                ['[Rollup](#rollup) and Rolldown', '`plugins: [crossbind()]`', 'Browser'],
                ['[Metro](#metro)', 'around the config: `crossbind(getDefaultConfig(__dirname))`', "[React Native](/guide/react-native/), and Expo's web build"],
            ],
        },
        {
            type: 'p',
            text: "The tool's first use of `crossbind()` decides which integration answers it: crossbind brings those of Vite, Rollup, Webpack and Metro, and [another tool](#own-plugin) joins through an extension. Each reads the project's `crossbind.config.js`, or `crossbind.config.mjs`, from the folder the tool runs in. A page with no bundler builds with the CLI instead: see [No bundler](/guide/browser/#no-bundler).",
        },

        { type: 'h2', id: 'vite', text: 'Vite' },
        {
            type: 'code',
            file: 'vite.config.js',
            code: `import { defineConfig } from 'vite';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [crossbind()],
});`,
        },
        {
            type: 'p',
            text: "It sits next to your framework's plugin; React, Vue and Svelte need nothing more.",
        },

        { type: 'h2', id: 'webpack', text: 'Webpack' },
        {
            type: 'code',
            file: 'webpack.config.js',
            code: `const crossbind = require('crossbind');

module.exports = {
    plugins: [crossbind()],
};`,
        },
        {
            type: 'p',
            text: "As the compiler applies it, `crossbind()` adds the rule that makes headers and `.rs` files modules, and the dev server's COOP/COEP headers and the middleware that serves the compiled module. A `devServer` block of your own stays as it is: crossbind's headers join its `headers`, and its middleware goes in front of your `setupMiddlewares`.",
        },

        { type: 'h2', id: 'rspack', text: 'Rspack' },
        {
            type: 'p',
            text: 'Rspack takes the same plugin through its Webpack-compatible API.',
        },
        {
            type: 'code',
            file: 'rspack.config.mjs',
            code: `import { defineConfig } from '@rspack/cli';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [crossbind()],
});`,
        },

        { type: 'h2', id: 'rollup', text: 'Rollup' },
        {
            type: 'p',
            text: 'For a plain Rollup or Rolldown build. Rollup has no dev server: `rollup -c -w` rebuilds the wasm when a native file changes, and nothing reloads a page.',
        },
        {
            type: 'code',
            file: 'rollup.config.mjs',
            code: `import crossbind from 'crossbind';

export default {
    input: 'src/index.js',
    output: { file: 'dist/index.js', format: 'esm' },
    plugins: [crossbind()],
};`,
        },
        {
            type: 'p',
            text: 'The bundle step writes `crossbind.js` and `crossbind.wasm` into the output directory. Plain Rollup has no base path, so the generated code loads them from the site root.',
        },

        { type: 'h2', id: 'metro', text: 'Metro' },
        {
            type: 'p',
            text: "Metro has no plugin list, so `crossbind()` wraps its config, as the outermost wrapper. It is set up with the rest of a React Native app: see [React Native](/guide/react-native/#metro), and [Expo](/guide/react-native/#expo) for the web build it makes as well.",
        },

        { type: 'h2', id: 'own-plugin', text: 'Another bundler' },
        {
            type: 'p',
            text: `A tool crossbind does not know joins through an extension that gives an \`integration\`: its \`claims\` says which first use of \`crossbind()\` is its tool's, and its \`plugin(api)\` makes the tool's plugin from the api crossbind hands it. A tool with no plugin list takes \`crossbind(config)\` around its config instead, through \`wraps\` and \`wrap\`. [Integrations](${INTEGRATIONS_URL}) in the extensions reference has the contract, and \`extensions/rollup\` in the repository is the smallest one to copy; list yours in \`crossbind.config.js\`'s \`extensions\`.`,
        },
    ],
};

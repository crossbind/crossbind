import { changelogHref } from '../../changelog/route.js';
import {
    AGENT_PROMPT_PATH, BRAND, CREATE_COMMAND, installCommand, SETUP_LINE, TUTORIAL_URL,
} from '../../data.js';
import { RELEASE, WEB_IMAGE } from '../../release.js';

const PLUGIN = RELEASE.companions['@crossbind/plugin-vite'];
const CREATOR = RELEASE.companions['create-crossbind'];

// These three come from data.js on purpose: the hero's setup modal, the landing's scaffolder
// terminal and this page have to show the same commands, and the skill has to outrank the prompt
// in both places. See the TODO(rename) note at the top of data.js.
export default {
    slug: 'quick-start',
    title: 'Quick start',
    description: 'Prerequisites, a new project or an existing one, and your first call into C++.',
    lede: `Scaffold a new project, or add ${BRAND} to an app you already have. Either way you end up with a bundler plugin, a \`crossbind.config.js\` and a header you import from JavaScript.`,
    blocks: [
        {
            type: 'callout',
            title: 'Rather try it first?',
            text: `The [tutorial](${TUTORIAL_URL}) runs in your browser with nothing to install: nine short steps from a first function to Rust and packages.`,
        },
        { type: 'h2', id: 'prerequisites', text: 'Prerequisites' },
        {
            type: 'p',
            text: 'The toolchains come as Docker images, so you need little on your machine:',
        },
        {
            type: 'ul',
            items: [
                '**Docker**, for the WebAssembly, WASI and Android toolchains. The first build pulls the images. Without Docker, [Remote builds](/guide/remote-builds/) run them on another machine.',
                '**Node.js 26+**.',
                '**CMake 3.28+**, for mobile only.',
                '**Xcode** and **CocoaPods**, for iOS only, on a Mac. Xcode must find Node.js; see [React Native](/guide/react-native/#ios).',
                '**A Rust toolchain** (`cargo` and the platform targets), only for Rust on iOS or macOS, or with `RUNNER=LOCAL`. Other builds run cargo in the image. See [Rust](/guide/rust/).',
                '**wasmtime**, only to run WASI output and the prebuilt `-standalone-wasi` tools.',
            ],
        },
        {
            type: 'code',
            file: 'shell',
            code: `docker --version
node --version
docker pull ${WEB_IMAGE}   # optional: the first build pulls it anyway`,
        },

        { type: 'h2', id: 'ai', text: 'Set it up with a coding agent' },
        {
            type: 'p',
            text: `Using a coding agent such as Claude Code, Codex, Cursor or Copilot? Paste this line into it. The agent installs the ${BRAND} skill, adds ${BRAND} to the project and checks one call from JavaScript, following [these instructions](${AGENT_PROMPT_PATH}).`,
        },
        { type: 'code', file: 'prompt', code: SETUP_LINE },
        { type: 'p', text: 'Prefer to do it yourself? Keep going.' },

        { type: 'h2', id: 'new-project', text: 'A new project' },
        {
            type: 'p',
            text: 'The scaffolder sets up the bundler, its plugin and a starter `crossbind.config.js`. Answer the prompts; if unsure, pick Web, React and Vite. For a desktop or mobile app, pick Desktop and App, then follow [Apps](/guide/apps/).',
        },
        { type: 'code', file: 'shell', code: CREATE_COMMAND },
        {
            type: 'code',
            file: 'shell',
            code: `? Project name › my-app
? Where should we create your project? › ./my-app
? What kind of project? › Web
? Choose framework / variant › React
? Choose bundler / ecosystem › Vite`,
        },
        {
            type: 'p',
            text: 'Arguments answer the prompts in order, for CI and scripts:',
        },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Web React Vite` },
        {
            type: 'p',
            text: 'Then install, start the dev server, and skip to [your first call](#first-call).',
        },
        {
            type: 'code',
            file: 'shell',
            code: `cd my-app
npm install
npm run dev`,
        },

        { type: 'h2', id: 'existing-project', text: 'An existing project' },
        {
            type: 'p',
            text: 'Install the plugin for your bundler and register it. Vite is shown here; Webpack, Rspack and Rollup are on [Bundler plugins](/guide/bundler-plugins/), Metro on [React Native](/guide/react-native/#metro).',
        },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/plugin-vite') },
        {
            type: 'callout',
            tone: 'note',
            title: 'Versions on this page',
            text: `${RELEASE.distTagSuffix ? `Install commands here follow the npm \`${RELEASE.distTag}\` tag` : 'Install commands here follow the default npm tag'}. `
                + `When this page was built, that meant \`${BRAND}@${RELEASE.version}\` ([changelog](${changelogHref(RELEASE.version)})), `
                + `\`@crossbind/plugin-vite@${PLUGIN.version}\` (for \`${BRAND} ${PLUGIN.crossbindRange}\`) and \`create-crossbind@${CREATOR.version}\`. `
                + 'To set up the same versions later, pin them:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm create crossbind@${CREATOR.version} my-app Web React Vite\nnpm install -D @crossbind/plugin-vite@${PLUGIN.version} ${BRAND}@${RELEASE.version}`,
        },
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
            text: 'The plugin reads `crossbind.config.js` from your project root. The minimal one sets `paths.config`, which every other path resolves from:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: {
        config: import.meta.url,
    },
};`,
        },
        {
            type: 'p',
            text: 'Everything else it takes: [Configuration](/guide/configuration/).',
        },

        { type: 'h2', id: 'first-call', text: 'Your first call' },
        {
            type: 'p',
            text: 'C++ lives in `src/native`. Declare the class in a header: the binder reads only headers.',
        },
        {
            type: 'code',
            file: 'src/native/MySampleClass.h',
            code: `#pragma once
#include <string>

class MySampleClass {
public:
    static std::string sample() {
        return "Hello World!";
    }
};`,
        },
        {
            type: 'p',
            text: 'Import the header from your app and call it. The header module exports `initNative()`; one call starts every native module you imported. In a browser the module runs in a Web Worker by default, so each call returns a promise.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, MySampleClass } from './native/MySampleClass.h';

await initNative();
console.log(await MySampleClass.sample());`,
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'First build',
            text: 'The first `npm run dev` compiles in Docker and takes a while. Later builds reuse the cache, and editing the header reloads the page.',
        },

        { type: 'h2', id: 'build', text: 'Build for production' },
        {
            type: 'p',
            text: "Your bundler's build compiles a release build through the plugin.",
        },
        { type: 'code', file: 'shell', code: 'npm run build' },
        {
            type: 'p',
            text: 'Building for another platform? Each one has its own page: [Node.js](/guide/node/), [Edge](/guide/edge/), [Electron](/guide/electron/), [Apps](/guide/apps/), [React Native](/guide/react-native/) and [Executables](/guide/executables/).',
        },

        { type: 'h2', id: 'next', text: 'Where to next' },
        {
            type: 'ul',
            items: [
                '[C++](/guide/bindings/): what binds, and the C++ and JavaScript types.',
                '[crossbind ports](/guide/libraries/): use a prebuilt library instead of compiling one.',
                '[Files](/guide/filesystem/): where files live in the browser, in Node.js and on the edge.',
                '[Troubleshooting](/guide/troubleshooting/): when the first build fails.',
            ],
        },
    ],
};

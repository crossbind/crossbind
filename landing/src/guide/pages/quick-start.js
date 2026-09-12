import { changelogHref } from '../../changelog/route.js';
import {
    BRAND, CREATE_COMMAND, installCommand, SETUP_PROMPT, SKILL_COMMAND,
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
    kicker: 'START HERE',
    description: 'Prerequisites, a new project or an existing one, and your first call into C++.',
    lede: `Two paths lead to the same place: scaffold a fresh project, or add ${BRAND} to an app you already have. Either way you end up with a bundler plugin, a \`crossbind.config.js\`, and a header you can import from JavaScript.`,
    blocks: [
        { type: 'h2', id: 'prerequisites', text: 'Prerequisites' },
        {
            type: 'p',
            text: `The cross-toolchain ships as a Docker image, so ${BRAND} needs very little installed on your machine:`,
        },
        {
            type: 'ul',
            items: [
                '**Docker** - carries the web, Android and WASI toolchains. Pulled automatically on the first build.',
                '**Node.js 24+**.',
                '**CMake 3.28+** - mobile only.',
                '**Xcode** and **CocoaPods** - iOS only, macOS only.',
                '**A Rust toolchain** (`cargo` plus the platform targets) - only when you bind Rust. See [Rust](/guide/rust/).',
                '**wasmtime** - only to run `platform: \'wasi\'` output and the prebuilt `-bin-wasi` tools.',
            ],
        },
        {
            type: 'code',
            file: 'shell',
            code: `docker --version
node --version
docker pull ${WEB_IMAGE}   # optional: the first build pulls it anyway`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'iOS',
            text: 'Xcode looks for Node.js in the system environment. If it is not there, link it once: `ln -s $(which node) /usr/local/bin/node`.',
        },

        { type: 'h2', id: 'ai', text: 'Set it up with a coding agent' },
        {
            type: 'p',
            text: `Using Claude Code, Cursor, Copilot or similar? Install the skill once - your agent then carries the project inspector, the current port catalog and the per-framework playbooks, and you can ask it to add ${BRAND} without pasting anything.`,
        },
        { type: 'code', file: 'shell', code: SKILL_COMMAND },
        {
            type: 'p',
            text: 'Drop `--global` to install it into this project only. For clients that cannot install skills, hand over this prompt instead - it inspects the repo, installs the right plugin, writes the config and wires your bundler:',
        },
        { type: 'code', file: 'prompt', code: SETUP_PROMPT },
        { type: 'p', text: 'Prefer to do it yourself? Keep going.' },

        { type: 'h2', id: 'new-project', text: 'A new project' },
        {
            type: 'p',
            text: 'The scaffolder wires the bundler, its plugin and a starter `crossbind.config.js` for you. Answer the prompts - if you are unsure, pick Web, React and Vite.',
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
            text: 'Every prompt can be preselected positionally, which is how CI and scripted setups create a project:',
        },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Web React Vite` },
        {
            type: 'p',
            text: 'Then install and start the dev server - and skip to [your first call](#first-call).',
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
            text: 'Already have an app? Install the plugin for your bundler and register it. Vite is shown here; Webpack, Rspack, Rollup and Metro follow the same shape with their own plugin - see [Bundlers](/guide/bundlers/).',
        },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/plugin-vite') },
        {
            type: 'callout',
            tone: 'note',
            title: 'Versions on this page',
            text: `${RELEASE.distTagSuffix ? `Every install command here follows the npm \`${RELEASE.distTag}\` tag` : 'Every install command here follows the default npm tag'}. `
                + `When this page was built it resolved to \`${BRAND}@${RELEASE.version}\` ([changelog](${changelogHref(RELEASE.version)})), `
                + `\`@crossbind/plugin-vite@${PLUGIN.version}\` (which requires \`${BRAND} ${PLUGIN.crossbindRange}\`) and \`create-crossbind@${CREATOR.version}\`. `
                + 'Each package keeps its own version; for a setup you can reproduce later, pin those exact ones:',
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
            text: 'The plugin reads a `crossbind.config.js` from your project root. The minimal one is two lines - `paths.config` anchors every other path to this file, so it is never optional:',
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
            text: 'Everything else this file can carry is in [Configuration](/guide/configuration/).',
        },

        { type: 'h2', id: 'first-call', text: 'Your first call' },
        {
            type: 'p',
            text: 'C++ lives under `src/native`. Declare the class in a header - the public surface has to be in the header, because that is what the binder reads.',
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
            text: 'Now import that header from your app code and call it. `initNative()` is exported by the header module itself; one call boots every native module you imported.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, MySampleClass } from './native/MySampleClass.h';

await initNative();
console.log(MySampleClass.sample());`,
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'First build',
            text: 'The first `npm run dev` compiles the wasm inside Docker and can take a while. After that the cache makes rebuilds incremental, and editing the header hot-reloads the page.',
        },

        { type: 'h2', id: 'build', text: 'Build for production' },
        {
            type: 'p',
            text: 'Nothing special: your bundler build triggers the release compile through the plugin.',
        },
        { type: 'code', file: 'shell', code: 'npm run build' },
        {
            type: 'p',
            text: 'Targeting Node, Cloudflare Workers, React Native or WASI instead? Each one is a `crossbind build` flag combination - see [Runtimes](/guide/runtimes/).',
        },

        { type: 'h2', id: 'next', text: 'Where to next' },
        {
            type: 'ul',
            items: [
                '[C++ bindings](/guide/bindings/) - what the auto-binder accepts, and the C++ ↔ JS type table.',
                '[Libraries](/guide/libraries/) - use a prebuilt library instead of compiling one.',
                '[Filesystem](/guide/filesystem/) - where files live in the browser, Node and on edge.',
                '[Troubleshooting](/guide/troubleshooting/) - when the first build does not go to plan.',
            ],
        },
    ],
};

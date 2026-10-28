import { BRAND, SHOWCASE_COUNT } from '../../data.js';
import { LIMITS, WHY_POINTS } from '../../why.js';

export default {
    slug: '',
    title: 'Introduction',
    // /guide/ is what the Docs menu calls Guide, so its tab says so.
    headTitle: 'Guide',
    description: 'What crossbind does, what one import buys you, and where the output runs.',
    lede: `${BRAND} compiles C++ and Rust into WebAssembly, Node-API addons and native iOS and Android libraries, then hands the result to JavaScript as an ordinary module; the same sources also build into desktop and mobile apps around a page of yours, and into executables that need no JavaScript at all. You import a header; the bindings are generated from it.`,
    blocks: [
        {
            type: 'p',
            text: 'There is no glue code to write and no second build system to run. The header you already have is the interface: whatever it declares - functions, classes, inheritance, overloads, vectors, maps, enums - shows up on the JavaScript side under the same names.',
        },

        { type: 'h2', id: 'one-import', text: 'One import, no glue' },
        {
            type: 'p',
            text: 'Put your C++ under `src/native`, then import the header from JavaScript. `initNative()` boots the runtime once; after it resolves, every symbol the header exposes is callable. In a browser the module runs in a Web Worker by default, so calls return promises.',
        },
        {
            type: 'code',
            file: 'src/native/helloWorld.h',
            code: `#pragma once
#include <string>

std::string getHelloWorldMessage() {
    return "Hello World!";
}`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, getHelloWorldMessage } from './native/helloWorld.h';

await initNative();
console.log(await getHelloWorldMessage());`,
        },
        {
            type: 'p',
            text: 'The same shape works for Rust: an app-local `.rs` file, or a crates.io crate imported through the `cargo:` scheme. See [Rust](/guide/rust/).',
        },

        { type: 'h2', id: 'prebuilt', text: 'Libraries you do not have to build' },
        {
            type: 'p',
            text: `${SHOWCASE_COUNT} C and C++ libraries ship prebuilt as \`@crossbind/port-*\` - GDAL, OpenSSL, SQLite, GEOS, PROJ and more, compiled from the real upstream sources at pinned versions. Install the variant for your platform and import its header directly; the upstream library is precompiled, and only your own code, the bindings and the final link go through the build toolchain.`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, GDALVersionInfo } from '@crossbind/port-gdal/gdal.h';

await initNative();
console.log(await GDALVersionInfo('RELEASE_NAME'));`,
        },
        {
            type: 'p',
            text: 'One `initNative()` covers every module on the page: each imported header registers its bindings, the call boots the runtime and resolves all of them together. Full details in [crossbind ports](/guide/libraries/); every library is listed under [Libraries](/ports/).',
        },
        {
            type: 'p',
            text: 'The same one-line import reaches two registries: a Rust crate from [crates.io](/guide/crates-io/) with `cargo:`, and a C or C++ package from [ConanCenter](/guide/conan/) with `conan:`.',
        },

        { type: 'h2', id: 'platforms', text: 'Where the output runs' },
        {
            type: 'table',
            head: ['Platform', 'What is produced'],
            rows: [
                ['[Browser](/guide/browser/)', 'WebAssembly and a JavaScript loader, through your bundler'],
                ['[Node.js](/guide/node/)', 'WebAssembly, or a native Node-API addon'],
                ['[Edge](/guide/edge/)', 'WebAssembly for Cloudflare Workers, or a `wasi:http` component'],
                ['[Electron](/guide/electron/)', 'The Node-API addon, loaded in the main process'],
                ['[Apps](/guide/apps/)', 'An app for macOS, Linux, Windows, iOS or Android: your page in the system webview, native code in its own process'],
                ['[React Native](/guide/react-native/)', 'Native iOS and Android code over JSI - no wasm'],
                ['[Executables](/guide/executables/)', 'Native programs for macOS, Linux and Windows, or a WASI command'],
            ],
        },
        {
            type: 'p',
            text: 'The JavaScript you write does not change between the JavaScript platforms; the build target does. Executables and `wasi:http` components run with no JavaScript host.',
        },

        { type: 'h2', id: 'bundle', text: 'What ends up in your bundle' },
        {
            type: 'p',
            text: 'Only the code reachable from the headers you imported is linked in: dead-code elimination on top of -O3 is on by default, so pulling two functions out of a large library costs those functions and what they reach, not the whole library.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Android',
            text: 'Dead-code elimination is not implemented for Android builds; those link the full archive.',
        },
        { type: 'p', text: '[Performance and size](/guide/performance/) has the rest: what you can tune and what to leave alone.' },

        { type: 'h2', id: 'two-ways', text: 'Two ways to use it' },
        {
            type: 'ul',
            items: [
                '**Write C++ (or Rust) yourself.** Your own sources under `src/native`, imported by header. Best when the work belongs on the native side - a whole pipeline in one call, no boundary crossing per step.',
                '**Drive a prebuilt library from JavaScript.** Import the package header and call into it directly. Quickest to wire up, and the way most people start.',
            ],
        },
        {
            type: 'p',
            text: 'Both paths use the same runtime and the same `initNative()` call, and they mix freely in one project.',
        },

        { type: 'h2', id: 'why', text: 'Why crossbind' },
        {
            type: 'p',
            text: 'The header import is the front door. Underneath it, crossbind is the native library distribution layer for JavaScript runtimes: versioned packages, target-specific artifacts, transitive dependencies, build recipes and runtime adapters.',
        },
        { type: 'ul', items: WHY_POINTS.map(([title, text]) => `**${title}.** ${text.charAt(0).toUpperCase()}${text.slice(1)}`) },

        { type: 'h2', id: 'limits', text: 'Limits worth knowing' },
        { type: 'ul', items: LIMITS },
        {
            type: 'p',
            text: 'Every option and default is in [Configuration](/guide/configuration/), [Runtime API](/guide/runtime-api/) and [CLI](/guide/cli/).',
        },

        { type: 'h2', id: 'next', text: 'Where to next' },
        {
            type: 'ul',
            items: [
                '[Quick start](/guide/quick-start/) - from an empty directory to a running app.',
                '[Tutorial](/tutorial/) - short steps that run in your browser, with nothing to install.',
                '[C++](/guide/bindings/) - the rules your headers have to follow, and the type table.',
                '[Troubleshooting](/guide/troubleshooting/) - the errors people hit most, with the standard fix for each.',
            ],
        },
    ],
};

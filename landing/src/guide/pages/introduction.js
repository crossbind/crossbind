import { BRAND, SHOWCASE_COUNT } from '../../data.js';
import { LIMITS, WHY_POINTS } from '../../why.js';

export default {
    slug: 'introduction',
    title: 'Introduction',
    kicker: 'START HERE',
    description: 'What crossbind does, what one import buys you, and where the output runs.',
    lede: `${BRAND} compiles C++ and Rust into WebAssembly, native iOS and Android libraries, and WASI commands - then hands the result to JavaScript as an ordinary module. You import a header; the bindings are generated from it.`,
    blocks: [
        {
            type: 'p',
            text: 'There is no glue code to write and no second build system to run. The header you already have is the interface: whatever it declares - functions, classes, inheritance, overloads, vectors, maps, enums - shows up on the JavaScript side under the same names.',
        },

        { type: 'h2', id: 'one-import', text: 'One import, no glue' },
        {
            type: 'p',
            text: 'Put your C++ under `src/native`, then import the header from JavaScript. `initNative()` boots the runtime once; after it resolves, every symbol the header exposes is callable.',
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
console.log(getHelloWorldMessage());`,
        },
        {
            type: 'p',
            text: 'The same shape works for Rust: an app-local `.rs` file, or a crates.io crate imported through the `cargo:` scheme. See [Rust](/guide/rust/).',
        },

        { type: 'h2', id: 'prebuilt', text: 'Libraries you do not have to build' },
        {
            type: 'p',
            text: `${SHOWCASE_COUNT} C++ libraries ship prebuilt as \`@crossbind/port-*\` - GDAL, OpenSSL, SQLite, GEOS, PROJ and more, compiled from the real upstream sources at pinned versions. Install one and import its header directly; nothing is compiled on your machine.`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, GDALVersionInfo } from '@crossbind/port-gdal/gdal.h';

await initNative();
console.log(GDALVersionInfo('RELEASE_NAME'));`,
        },
        {
            type: 'p',
            text: 'One `initNative()` covers every module on the page: each imported header registers its bindings, the call boots the runtime and resolves all of them together. Full details in [Libraries](/guide/libraries/); every library is listed under [Libraries](/ports/).',
        },

        { type: 'h2', id: 'platforms', text: 'Where the output runs' },
        {
            type: 'table',
            head: ['Target', 'What is produced', 'Guide'],
            rows: [
                ['Browser', 'WebAssembly + a JS loader', '[Runtimes](/guide/runtimes/)'],
                ['Node.js', 'WebAssembly, host filesystem access', '[Runtimes](/guide/runtimes/)'],
                ['Cloudflare Workers / edge', 'WebAssembly, single-threaded, in-memory fs', '[Runtimes](/guide/runtimes/)'],
                ['iOS and Android', 'Native machine code over JSI - no wasm', '[Runtimes](/guide/runtimes/)'],
                ['WASI (`wasm32-wasip3`)', 'One `.wasm` command, no JS host', '[WASI commands](/guide/wasi/)'],
            ],
        },
        {
            type: 'p',
            text: 'The JavaScript you write does not change between them. The build target does.',
        },

        { type: 'h2', id: 'bundle', text: 'What ends up in your bundle' },
        {
            type: 'p',
            text: 'Only the code reachable from the headers you imported is linked in. Dead-code elimination and LTO are on by default, so pulling two functions out of a large library costs two functions, not the library.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Android',
            text: 'Dead-code elimination is not implemented for Android builds; those link the full archive.',
        },

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
            text: 'Browse the [Libraries](/ports/) that ship prebuilt, or read the [API reference](/api/) for every option and default.',
        },

        { type: 'h2', id: 'next', text: 'Where to next' },
        {
            type: 'ul',
            items: [
                '[Quick start](/guide/quick-start/) - from an empty directory to a running app.',
                '[Bundlers](/guide/bundlers/) - Vite, Webpack, Rspack, Rollup, Metro, or no bundler at all.',
                '[C++ bindings](/guide/bindings/) - the rules your headers have to follow, and the type table.',
                '[Troubleshooting](/guide/troubleshooting/) - the errors people hit most, with the standard fix for each.',
            ],
        },
    ],
};

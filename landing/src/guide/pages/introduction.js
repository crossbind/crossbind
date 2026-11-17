import { BRAND, SHOWCASE_COUNT } from '../../data.js';
import { LIMITS, WHY_POINTS } from '../../why.js';

export default {
    slug: '',
    title: 'Introduction',
    // /guide/ is what the Docs menu calls Guide, so its tab says so.
    headTitle: 'Guide',
    description: 'What crossbind does, what one import buys you, and where the output runs.',
    lede: `${BRAND} compiles C++ and Rust into WebAssembly, Node-API addons and native iOS and Android libraries, and hands them to JavaScript as an ordinary module. You import a header; the bindings are generated from it. The same sources also build into apps around a page of yours, and into executables that need no JavaScript.`,
    blocks: [
        {
            type: 'p',
            text: 'No glue code, no second build system. Whatever the header declares (functions, classes, inheritance, overloads, vectors, maps, enums) shows up in JavaScript under the same names.',
        },

        { type: 'h2', id: 'one-import', text: 'One import, no glue' },
        {
            type: 'p',
            text: 'Put your C++ in `src/native` and import the header from JavaScript. Call `initNative()` once; after it resolves, everything the header declares is callable. In a browser the module runs in a Web Worker by default, so calls return promises.',
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
            text: 'Rust works the same way: import a `.rs` file of the app, or a crates.io crate with `cargo:`. See [Rust](/guide/rust/).',
        },

        { type: 'h2', id: 'prebuilt', text: 'Libraries you do not have to build' },
        {
            type: 'p',
            text: `${SHOWCASE_COUNT} C and C++ libraries ship prebuilt as \`@crossbind/port-*\`: GDAL, OpenSSL, SQLite, GEOS, PROJ and more, built from upstream sources at pinned versions. Install the variant for your platform and import its header; only your own code, the bindings and the final link are compiled.`,
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
            text: 'One `initNative()` covers every header you import. More in [crossbind ports](/guide/libraries/); every library is listed under [Libraries](/ports/).',
        },
        {
            type: 'p',
            text: 'The same import reaches two registries: a Rust crate from [crates.io](/guide/crates-io/) with `cargo:`, and a C or C++ package from [ConanCenter](/guide/conan/) with `conan:`.',
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
                ['[Apps](/guide/apps/)', 'A macOS, Linux, Windows, iOS or Android app around your page'],
                ['[React Native](/guide/react-native/)', 'Native iOS and Android code over JSI, no wasm'],
                ['[Executables](/guide/executables/)', 'Native programs for macOS, Linux and Windows, or a WASI command'],
            ],
        },
        {
            type: 'p',
            text: 'Your JavaScript stays the same across these platforms; only the build target changes. Executables and `wasi:http` components run without a JavaScript host.',
        },

        { type: 'h2', id: 'bundle', text: 'What ends up in your bundle' },
        {
            type: 'p',
            text: 'Only the code your imported headers reach is linked in: two functions of a large library cost those functions, not the whole library. Android is the exception: its builds link whole archives.',
        },
        { type: 'p', text: 'What you can tune: [Performance and size](/guide/performance/).' },

        { type: 'h2', id: 'two-ways', text: 'Two ways to use it' },
        {
            type: 'ul',
            items: [
                '**Write C++ or Rust yourself.** Your own sources in `src/native`, imported by header. Best when the work belongs on the native side: a whole pipeline in one call.',
                "**Call a prebuilt library from JavaScript.** Import the package's header and call it. The quickest start.",
            ],
        },
        {
            type: 'p',
            text: 'Both use the same `initNative()` and mix freely in one project.',
        },

        { type: 'h2', id: 'why', text: 'Why crossbind' },
        {
            type: 'p',
            text: 'Beneath the header import, crossbind distributes native libraries for JavaScript runtimes: versioned packages, binaries per target, their dependencies, build recipes and runtime adapters.',
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
                '[Quick start](/guide/quick-start/): from an empty folder to a running app.',
                '[Tutorial](/tutorial/): short steps that run in your browser, with nothing to install.',
                '[C++](/guide/bindings/): the rules your headers follow, and the type table.',
                '[Troubleshooting](/guide/troubleshooting/): the most common errors and their fixes.',
            ],
        },
    ],
};

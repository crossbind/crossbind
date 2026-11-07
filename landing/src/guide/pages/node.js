import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const example = (name) => `[${name}](${REPO_URL}/tree/main/examples/${name})`;

export default {
    slug: 'node',
    title: 'Node.js',
    description: 'Run C++ in Node.js as WebAssembly or as a native Node-API addon, and import headers directly.',
    lede: 'Node.js runs your C++ two ways: as WebAssembly, one `.wasm` file for every operating system, or as a Node-API addon, native code built for each platform. Both keep the `initNative()` contract, so the same app code runs on either.',
    blocks: [
        { type: 'h2', id: 'which', text: 'Which one' },
        {
            type: 'table',
            head: ['', 'WebAssembly', 'Node-API addon'],
            rows: [
                ['Output', 'one `.wasm` and a loader, for every OS and CPU', 'a `.node` file per platform and architecture, and a loader that picks one'],
                ['Built on', 'any machine with Docker', 'Linux and Windows addons in Docker on any host, macOS addons on a Mac'],
                ['Files', '`m.FS` reads and writes the host disk', 'C++ uses the OS directly; there is no `m.FS`'],
                ['Threads', '`-r mt` runs pthreads, with no setup', 'one Node environment per process, so no `worker_threads`'],
            ],
        },
        {
            type: 'p',
            text: 'Take the addon for [Electron](/guide/electron/)\'s main process, for native memory or system access, or to use a port with nothing to build. It is not automatically faster: on an M-series Mac a call returning or taking a short `std::string` took about 70 and 85 ns as an addon against 160 and 155 ns on wasm, but a `const char*` argument took about 1.2 µs against 0.33 µs and a callback into JavaScript about 2.1 µs against 0.5 µs, and compute-bound runs went either way. Measure your workload before switching.',
        },

        { type: 'h2', id: 'wasm', text: 'WebAssembly' },
        { type: 'p', text: 'Install `crossbind`, point `paths.output` at `dist` and build with `-e node`:' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install -D crossbind${suffix}
npx crossbind build -p wasm -a wasm32 -r st -e node -b release`,
        },
        {
            type: 'p',
            text: 'The loader, `dist/my-app-wasm-wasm32-st-release.node.js`, is CommonJS, so `require` and `import` both load it; the build gives `dist` a `package.json` that says so, unless it has one. Calls are synchronous - Node has no Web Worker.',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import initNative from '../dist/my-app-wasm-wasm32-st-release.node.js';

const { Native } = await initNative();
console.log(Native.sample());`,
        },
        {
            type: 'p',
            text: 'The same build writes `dist/node/wasm.mjs`, which exports every bound name directly: `import { initNative, Native } from \'../dist/node/wasm.mjs\'`.',
        },
        { type: 'h3', text: 'Import headers directly' },
        {
            type: 'p',
            text: 'A Node.js app can also import its native code the way a bundler app does: its own header, a library header, a `conan:` header, a `.rs` file or a `cargo:` crate.',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import { initNative, Native } from './native/native.h';

await initNative();
console.log(Native.sample());`,
        },
        {
            type: 'p',
            text: 'While developing, start Node through `crossbind/node/dev`. Before the app starts, it builds whenever the native sources, the config or the native imports changed since its last build; the second line also restarts the app, and so rebuilds, when a file in `src/native` changes:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `node --import crossbind/node/dev src/index.mjs
node --watch --watch-path=src/native --import crossbind/node/dev src/index.mjs`,
        },
        {
            type: 'p',
            text: '`crossbind build -e node` finds these imports in your sources, binds them and writes the hooks that serve them, `dist/node/wasm.register.mjs`. A deployed app starts with those and needs no crossbind:',
        },
        { type: 'code', file: 'shell', code: 'node --import ./dist/node/wasm.register.mjs src/index.mjs' },
        {
            type: 'p',
            text: 'An import the build did not see - a specifier computed at run time, or one added since - fails with an error that says to build again. `require()` of a header works too; read its names after `initNative()` resolves.',
        },
        { type: 'h3', text: 'Files and threads' },
        {
            type: 'p',
            text: '`m.FS` is the host filesystem: C++ opens real paths, relative ones resolve against `process.cwd()`, and `/memfs/` is an in-memory directory. Data files a library reads land in `dist/data`; ship them with the loader. Build with `-r mt` for a multithreaded module, which Node runs with no headers or flags; `dist/node/wasm.mjs` follows the single-threaded build only.',
        },

        { type: 'h2', id: 'addon', text: 'Node-API addon' },
        {
            type: 'p',
            text: 'An addon is native code inside the Node process: one `.node` file per platform and architecture, and a CommonJS loader that picks the one for `process.platform` and `process.arch` - on Linux, for the C library too.',
        },
        { type: 'h3', text: 'Prebuilt' },
        {
            type: 'p',
            text: 'The ports publish their addons prebuilt as `@crossbind/port-<name>-standalone-napi`: no build, no Docker, no crossbind. npm installs only the addon of the machine, and the package root exports every binding. The packages need Node.js 22.12 or later.',
        },
        { type: 'code', file: 'shell', code: `npm install @crossbind/port-zlib-standalone-napi${suffix}` },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import { initNative, zlibVersion } from '@crossbind/port-zlib-standalone-napi';

await initNative();
console.log(zlibVersion());`,
        },
        { type: 'h3', text: 'Your own addon' },
        {
            type: 'p',
            text: 'Build one when the app has C++ of its own. Install the Node-API host next to `crossbind`, keep `output: \'dist\'` in the config, and build this machine\'s platform with `-p host`:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install -D crossbind${suffix} @crossbind/core-embind-napi${suffix}
npx crossbind build -p host -e node -b release`,
        },
        {
            type: 'p',
            text: 'That writes an addon per architecture, such as `dist/my-app.darwin-arm64.node`, the loader `dist/my-app.native.cjs`, `dist/node/napi.mjs` with every bound name, and the data files a library reads in `dist/data`. A port you link needs the desktop packages you build for, such as `@crossbind/port-zlib-linux`, installed and listed in the config\'s `dependencies` - see [crossbind ports](/guide/libraries/).',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import initNative from '../dist/my-app.native.cjs';

const { Native } = await initNative();
console.log(Native.sample());`,
        },
        {
            type: 'p',
            text: 'The import hooks work the same way: with `@crossbind/core-embind-napi` installed, `crossbind/node/dev` builds the addon instead of the wasm, and a deployed app starts with `--import ./dist/node/napi.register.mjs`.',
        },
        {
            type: 'table',
            head: ['Platform', 'Built on', 'Runs on'],
            rows: [
                ['`darwin`', 'a Mac with Xcode\'s command line tools', 'macOS 11 or later'],
                ['`linux`', 'any host, in Docker', 'glibc 2.28 or later'],
                ['`linuxmusl`', 'any host, in Docker', 'musl 1.2.5 or later (Alpine 3.21 and newer)'],
                ['`win32`', 'any host, in Docker', 'Windows 10 or later'],
            ],
        },
        {
            type: 'p',
            text: '`-p host` picks `darwin`, `win32`, or on Linux `linux` or `linuxmusl` by the C library Node.js runs on; `-p darwin,linux,linuxmusl,win32` builds all four, each for arm64 and x64. A Mac builds its own addons without Docker: Xcode compiles them, and `@crossbind/bridge-tools`, which npm installs with crossbind there, generates the bindings as the image the wasm build uses would. To publish addons so that npm installs only the one a machine needs, see [Publishing packages](/guide/publishing/#package-types).',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**One Node environment per process.** The addon cannot load again in a `worker_threads` worker; `initNative()` there rejects with an error.',
                '**A Linux addon loads only on the C library it was built for.** Ship both `linux` and `linuxmusl` when the app may run on Alpine; the loader picks between them.',
                '**The browser build does not run in Node.** A `-e browser` loader is built for the web only; build with `-e node`.',
            ],
        },
        {
            type: 'p',
            text: `Complete apps: ${example('backend-nodejs-wasm')}, ${example('backend-nodejs-native')} and ${example('backend-nodejs-standalone')}. Each is also a template - \`${CREATE_COMMAND} my-app Backend Node.js WebAssembly\`, with \`Node-API\` or \`Standalone\` as the last word.`,
        },
    ],
};

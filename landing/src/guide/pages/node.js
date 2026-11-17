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
                ['Output', 'one `.wasm` and a loader, for every OS and CPU', 'a `.node` file per platform, and a loader that picks one'],
                ['Built on', 'any machine with Docker', 'Linux and Windows addons in Docker on any host, macOS addons on a Mac'],
                ['Files', '`m.FS` reads and writes the host disk', 'C++ uses the OS directly; there is no `m.FS`'],
                ['Threads', '`-r mt` runs pthreads, with no setup', 'one Node environment per process, so no `worker_threads`'],
            ],
        },
        {
            type: 'p',
            text: 'Take the addon for [Electron](/guide/electron/)\'s main process, for native memory or system access, or to use a port with nothing to build. It is not automatically faster: some calls are quicker as an addon and some on wasm ([measured](/guide/performance/#speed)), so measure your workload before switching.',
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
            text: 'The loader, `dist/my-app-wasm-wasm32-st-release.node.js`, is CommonJS, so `require` and `import` both load it. Calls are synchronous: Node.js runs the module without a worker.',
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
            text: 'While developing, start Node through `crossbind/node/dev`: it builds before the app starts when the native sources, the config or the imports changed. The second line also restarts the app when a file in `src/native` changes:',
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
            text: 'An import the build did not see, such as a specifier computed at run time, fails until you build again. `require()` of a header works too; read its names after `initNative()` resolves.',
        },
        { type: 'h3', text: 'Files and threads' },
        {
            type: 'p',
            text: '`m.FS` is the host filesystem: C++ opens real paths, relative to `process.cwd()`, and `/memfs/` is in memory. Data files a library reads land in `dist/data`; ship them with the loader. Build with `-r mt` for a multithreaded module, which Node runs with no setup; `dist/node/wasm.mjs` covers the single-threaded build only.',
        },

        { type: 'h2', id: 'addon', text: 'Node-API addon' },
        {
            type: 'p',
            text: 'An addon is native code inside the Node process: a `.node` file per platform and architecture, and a CommonJS loader that picks the right one (on Linux, also by C library).',
        },
        { type: 'h3', text: 'Prebuilt' },
        {
            type: 'p',
            text: 'Each port publishes its addon prebuilt as `@crossbind/port-<name>-standalone-napi`: no build, no Docker, no crossbind. npm installs only the addon for the machine. These packages need Node.js 22.12 or later.',
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
            text: 'That writes an addon per architecture (such as `dist/my-app.darwin-arm64.node`), the loader `dist/my-app.native.cjs`, `dist/node/napi.mjs` with every bound name, and library data files in `dist/data`. A port needs its desktop packages, such as `@crossbind/port-zlib-linux`, installed and listed in `dependencies`; see [crossbind ports](/guide/libraries/).',
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
            text: '`-p host` picks this machine\'s platform (on Linux, `linux` or `linuxmusl` by its C library); `-p darwin,linux,linuxmusl,win32` builds all four, each for arm64 and x64. A Mac builds its own addons without Docker. To publish addons so npm installs only the one a machine needs, see [Publishing packages](/guide/publishing/#package-types).',
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
            text: `Complete apps: ${example('backend-nodejs-wasm')}, ${example('backend-nodejs-native')} and ${example('backend-nodejs-standalone')}. Each is also a template: \`${CREATE_COMMAND} my-app Backend Node.js WebAssembly\`, with \`Node-API\` or \`Standalone\` as the last word.`,
        },
    ],
};

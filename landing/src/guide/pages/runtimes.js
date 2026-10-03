export default {
    slug: 'runtimes',
    title: 'Runtimes',
    description: 'Browser, Node, Cloudflare Workers, React Native and WASI - what each one supports.',
    lede: 'The same JavaScript runs on every runtime; what changes is the build target and which runtime features exist there. This page is the map: what to build, how to load it, and what is unavailable before you find out the hard way.',
    blocks: [
        { type: 'h2', id: 'matrix', text: 'What each runtime supports' },
        {
            type: 'table',
            head: ['Runtime', 'Output', 'Threads (mt)', 'useWorker', 'Persistent storage'],
            rows: [
                ['Browser', 'wasm + JS loader', 'yes, needs COOP/COEP', 'yes', 'OPFS, with `useWorker: true`'],
                ['Node.js', 'wasm + JS loader', 'yes', 'no (n/a)', 'the host filesystem'],
                ['Cloudflare Workers / edge', 'wasm + JS loader', 'no', 'no', 'no - external store only'],
                ['React Native', 'native `.a` / xcframework over JSI', 'yes, no headers needed', 'n/a', 'the app sandbox'],
                ['WASI', 'one `.wasm` command', 'no (single-threaded for now)', 'n/a', 'preopened host dirs'],
            ],
        },
        {
            type: 'p',
            text: 'Threading and `useWorker` are two independent axes, and the difference bites often enough to have its own page: [Threading and workers](/guide/threading/).',
        },

        { type: 'h2', id: 'flags', text: 'Target flags' },
        {
            type: 'p',
            text: 'A build target is a `{platform, arch, runtime, runtimeEnv, buildType}` tuple. With a bundler plugin the tuple is chosen for you; from the CLI you filter it with flags.',
        },
        {
            type: 'table',
            head: ['Flag', 'Values'],
            rows: [
                ['`-p` platform', '`wasm`, `wasi`, `android`, `ios`'],
                ['`-a` arch', '`wasm32`, `wasm64`, `arm64-v8a`, `x86_64`, `iphoneos`, `iphonesimulator`'],
                ['`-r` runtime', '`st`, `mt`'],
                ['`-e` runtimeEnv', '`browser`, `node`, `edge`'],
                ['`-b` buildType', '`release`, `debug`'],
            ],
        },
        { type: 'code', file: 'shell', code: 'crossbind build -p wasm -a wasm32 -r st -e browser -b release' },

        { type: 'h2', id: 'browser', text: 'Browser' },
        {
            type: 'p',
            text: 'The default. Install the plugin for your bundler, import the header, call `initNative()`. Two browser-only options matter:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative } from './native/native.h';

const m = await initNative({
    useWorker: true,       // wasm runs in a Web Worker; required for OPFS
    fs: { opfs: true },    // default in the browser
});`,
        },
        {
            type: 'p',
            text: 'With `useWorker: true` every call crosses a worker boundary and therefore returns a promise - including construction (`await new X()`). Files then live in [the filesystem](/guide/filesystem/) you mounted.',
        },

        { type: 'h2', id: 'node', text: 'Node.js' },
        {
            type: 'p',
            text: 'Build with `-e node` and import the generated loader. `m.FS` reads and writes the real host filesystem, so there is no `/opfs` versus `/memfs` distinction.',
        },
        {
            type: 'code',
            file: 'package.json',
            code: `{
    "scripts": {
        "build": "crossbind build -p wasm -e node -r st"
    },
    "devDependencies": {
        "crossbind": "^2.0.0-beta"
    }
}`,
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import initNative from '../dist/myapp-wasm-wasm32-st-release.node.js';

const { MySampleClass } = await initNative();
console.log(MySampleClass.sample());`,
        },
        {
            type: 'p',
            text: 'CommonJS works the same way with `require(...)`. Environment variables for the wasm process go through `init`\'s `env` option, where `_CROSSBIND_DATA_PATH_` expands to the runtime data path.',
        },

        { type: 'h2', id: 'edge', text: 'Cloudflare Workers and the edge' },
        {
            type: 'p',
            text: 'Edge runtimes are V8 isolates with no Web Worker API, so `useWorker` and `runtime: \'mt\'` are both unavailable - build `-e edge -r st`. Bundle the wasm and hand it to `initNative` directly, which avoids a network round-trip at cold start.',
        },
        {
            type: 'code',
            file: 'index.js',
            code: `import initNative from './dist/myapp-wasm-wasm32-st-release.edge.js';
import wasmContent from './dist/myapp-wasm-wasm32-st-release.edge.wasm';

const { MySampleClass } = await initNative({ getWasmFunction: () => wasmContent });

export default {
    async fetch(request, env, ctx) {
        return new Response(MySampleClass.sample());
    },
};`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'No persistence',
            text: 'The edge filesystem is in-memory and lives for one invocation. If you need durable bytes, read them from R2/KV/S3 in JavaScript and write them in with `m.FS.writeFile(...)`.',
        },

        { type: 'h2', id: 'react-native', text: 'React Native and Expo' },
        {
            type: 'p',
            text: 'Mobile compiles to real native code and reaches JavaScript through JSI - no wasm, no `SharedArrayBuffer`, no COOP/COEP. `runtime: \'mt\'` works with no host configuration. Wire Metro as shown in [Bundlers](/guide/bundlers/#metro), then call into the header from a component:',
        },
        {
            type: 'code',
            file: 'src/App.tsx',
            code: `import { useState, useEffect } from 'react';
import { initNative, MySampleClass } from './native/MySampleClass.h';

export default function App() {
    const [message, setMessage] = useState('compiling ...');

    useEffect(() => {
        initNative().then(() => setMessage(MySampleClass.sample()));
    }, []);

    return <Text>Response from C++ : {message}</Text>;
}`,
        },
        { type: 'h3', text: 'Expo' },
        {
            type: 'p',
            text: 'Expo Go cannot load custom native code, so switch to a development build first, then add the config plugin - it wires the native build during `expo prebuild`.',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx expo prebuild
npx expo customize metro.config.js`,
        },
        {
            type: 'code',
            file: 'app.json',
            code: `{
    "expo": {
        "plugins": ["@crossbind/plugin-react-native"]
    }
}`,
        },
        {
            type: 'p',
            text: 'iOS also needs `pod install` inside `ios/` before the first `npm run ios`.',
        },

        { type: 'h2', id: 'wasi', text: 'WASI' },
        {
            type: 'p',
            text: 'With `-p wasi` there is no JavaScript host at all: the output is a single `wasm32-wasip3` command you run under wasmtime. Prebuilt CLI tools ship the same way as npm packages. Full details in [WASI commands](/guide/wasi/).',
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind build -p wasi -e wasi -b release
wasmtime run --dir=. dist/myapp-wasi-wasm32-st-release.wasm input.txt`,
        },
    ],
};

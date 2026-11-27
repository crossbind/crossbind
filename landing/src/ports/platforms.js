import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';
import { httpComponentName, httpHandlerCode, spinManifestCode } from '../wasiHttp.js';
import { BIN_TARGET, NAPI_TARGET, publishedTarget } from './catalog.js';

// How a library goes into each kind of project: a browser app, Node.js, an edge runtime, Electron,
// React Native or an executable. Every statement is taken from docs/api and the integration playbooks, and
// only packages published on the release channel are named. Must stay importable from Node with no JSX.

const suffix = RELEASE.distTagSuffix;

export const PLATFORMS = [
    { target: 'wasm', label: 'WebAssembly', builds: '`wasm32`, single-threaded and multi-threaded' },
    { target: 'android', label: 'Android', builds: '`arm64-v8a` devices and the `x86_64` emulator' },
    { target: 'ios', label: 'iOS', builds: '`arm64` devices and simulators' },
    { target: 'darwin', label: 'macOS', builds: '`arm64` and `x64`, macOS 11 or later' },
    { target: 'linux', label: 'Linux', builds: '`x64` and `arm64`, glibc 2.28 or later' },
    { target: 'linuxmusl', label: 'Linux (musl)', builds: '`x64` and `arm64`, musl 1.2.5 or later' },
    { target: 'win32', label: 'Windows', builds: '`x64` and `arm64`, Windows 10 or later' },
    { target: 'wasi', label: 'WASI', builds: '`wasm32-wasip3`, single-threaded' },
];

const DESKTOP = ['darwin', 'linux', 'linuxmusl', 'win32'];

export const platformFor = (target) => PLATFORMS.find((platform) => platform.target === target) ?? null;

const variable = (port, target) => `${port.family.replace(/[^A-Za-z0-9]/g, '')}${target.charAt(0).toUpperCase()}${target.slice(1)}`;

export function configCode(port, targets, { name = null, output = null } = {}) {
    const imports = targets.map((target) => `import ${variable(port, target.target)} from '${target.package}/crossbind.config.js';`);
    return `${imports.join('\n')}

export default {${name ? `\n    general: { name: '${name}' },` : ''}
    dependencies: [${targets.map((target) => variable(port, target.target)).join(', ')}],
    paths: { config: import.meta.url${output ? `, output: '${output}'` : ''} },
};`;
}

// A Worker as examples/cloud-cloudflare-worker wires it: the edge build and its wasm imported as
// modules, initialised once per isolate on the first request, as the Cloudflare playbook advises.
const WORKER_ENTRY = `import initNative from './dist/my-worker-wasm-wasm32-st-release.edge.js';
import wasmContent from './dist/my-worker-wasm-wasm32-st-release.edge.wasm';

let native;

export default {
    async fetch() {
        native ??= initNative({ getWasmFunction: () => wasmContent });
        // Native is a class of your own in src/native/native.h.
        const { Native } = await native;
        return new Response(Native.sample());
    },
};`;

const WRANGLER_CONFIG = `name = "my-worker"
main = "index.js"
compatibility_date = "2024-09-08"`;

const METRO_CONFIG = `const { getDefaultConfig } = require('@react-native/metro-config');
const crossbind = require('crossbind');

module.exports = crossbind(getDefaultConfig(__dirname));`;

// More than two packages go one to a line, so the command stays readable without scrolling.
const install = (packages, devPackages = []) =>
    [packages, devPackages]
        .filter((names) => names.length)
        .map((names) => {
            const command = `npm install${names === devPackages ? ' --save-dev' : ''}`;
            const specs = names.map((name) => `${name}${suffix}`);
            return specs.length > 2 ? `${command} \\\n    ${specs.join(' \\\n    ')}` : `${command} ${specs.join(' ')}`;
        })
        .join('\n');

const publishedOf = (port, targets) => targets.map((target) => publishedTarget(port, target)).filter(Boolean);

const desktopTable = (variants) => ({
    type: 'table',
    head: ['Platform', 'Package', 'Built for'],
    rows: variants.map((variant) => [platformFor(variant.target).label, `\`${variant.package}\``, platformFor(variant.target).builds]),
});

const importCode = (port, napi) => `import * as ${port.family} from '${napi.package}';

await ${port.family}.initNative();`;

// A header import the library's checked examples make, for the tabs that import headers.
const headerCode = (headerImport) => `import { initNative, ${headerImport.name} } from '${headerImport.header}';

await initNative();`;

function browserBlocks(port, { headerImport }) {
    const wasm = publishedTarget(port, 'wasm');
    if (!wasm) return [];
    return [
        { type: 'p', text: `Runs in browsers; Node.js and edge runtimes use the same package. Built for ${platformFor('wasm').builds}.` },
        { type: 'code', file: 'shell', code: install([wasm.package]) },
        { type: 'code', file: 'crossbind.config.js', code: configCode(port, [wasm]) },
        ...(headerImport ? [{ type: 'code', file: 'main.js', code: headerCode(headerImport) }] : []),
        { type: 'p', text: `crossbind itself comes with your bundler plugin; [Bundler plugins](${guideHref('bundler-plugins')}) has Vite, Webpack, Rspack, Rsbuild, Rollup, esbuild, Bun and Next.js.` },
    ];
}

function nodeBlocks(port, { headerImport }) {
    const napi = publishedTarget(port, NAPI_TARGET);
    const wasm = publishedTarget(port, 'wasm');
    const desktop = publishedOf(port, DESKTOP);
    if (!napi && !wasm && !desktop.length) return [];
    return [
        ...(napi
            ? [
                  { type: 'h3', text: 'Prebuilt addon' },
                  { type: 'p', text: 'The prebuilt package needs no build: npm installs the addon of the machine, and every binding is an export.' },
                  { type: 'code', file: 'shell', code: install([napi.package]) },
                  { type: 'code', file: 'main.js', code: importCode(port, napi) },
              ]
            : []),
        ...(wasm
            ? [
                  { type: 'h3', text: 'WebAssembly' },
                  {
                      type: 'p',
                      text: 'The `-wasm` package runs in Node.js too, as one file for every platform and with no native build. Start Node through crossbind, and it builds whenever the native imports change.',
                  },
                  { type: 'code', file: 'shell', code: install([wasm.package], ['crossbind']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, [wasm]) },
                  ...(headerImport ? [{ type: 'code', file: 'main.js', code: headerCode(headerImport) }] : []),
                  { type: 'code', file: 'shell', code: 'node --import crossbind/node/dev main.js' },
                  { type: 'p', text: `[Node.js](${guideHref('node')}#wasm) has the build a deployed app starts with.` },
              ]
            : []),
        ...(desktop.length
            ? [
                  { type: 'h3', text: napi ? 'With C++ of your own' : 'Build the addon' },
                  {
                      type: 'p',
                      text: 'Your own headers and the library build into one addon. Install the platform packages you ship; the addon and its loader, `dist/<name>.native.cjs`, land in `dist`.',
                  },
                  { type: 'code', file: 'shell', code: install(desktop.map((variant) => variant.package), ['crossbind', '@crossbind/core-embind-napi']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, desktop) },
                  { type: 'code', file: 'shell', code: 'npx crossbind build -p host -e node -b release' },
                  desktopTable(desktop),
                  { type: 'p', text: `\`-p host\` builds this machine's platform. [Node.js](${guideHref('node')}#addon) has the whole flow.` },
              ]
            : []),
    ];
}

// A library with data files or environment is left out of the WASI part: no host mounts them for a component.
function edgeBlocks(port) {
    const wasm = publishedTarget(port, 'wasm');
    const wasi = port.hasWasiData ? null : publishedTarget(port, 'wasi');
    if (!wasm && !wasi) return [];
    return [
        ...(wasm
            ? [
                  { type: 'h3', text: 'Cloudflare Workers' },
                  {
                      type: 'p',
                      text: `Cloudflare Workers, and the edge runtimes that follow their model, run the \`-wasm\` package single-threaded, with no Worker and no OPFS. A Worker has no bundler plugin, so it reaches ${port.name} through a header of your own in \`src/native\`.`,
                  },
                  { type: 'code', file: 'shell', code: install([wasm.package], ['crossbind']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, [wasm], { name: 'my-worker', output: 'dist' }) },
                  { type: 'code', file: 'shell', code: 'npx crossbind build -p wasm -a wasm32 -r st -e edge -b release' },
                  { type: 'code', file: 'index.js', code: WORKER_ENTRY },
                  { type: 'code', file: 'wrangler.toml', code: WRANGLER_CONFIG },
                  { type: 'code', file: 'shell', code: 'npx wrangler dev\nnpx wrangler deploy' },
                  {
                      type: 'p',
                      text: `A free Worker gets 10 ms of CPU a request, and every plan caps a Worker's size: check the library's \`.wasm\` against yours. [Edge](${guideHref('edge')}#cloudflare-workers) has the rest.`,
                  },
              ]
            : []),
        ...(wasi
            ? [
                  { type: 'h3', text: 'WASI 0.3' },
                  {
                      type: 'p',
                      text: `Spin, wasmCloud and \`wasmtime serve\` run an HTTP component, one that exports \`wasi:http/handler\`: a handler of your own in \`src/native\`, with ${port.name} from the \`-wasi\` package linked in.`,
                  },
                  { type: 'code', file: 'shell', code: install([wasi.package], ['crossbind']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, [wasi], { name: 'my-service', output: 'dist' }) },
                  { type: 'code', file: 'src/native/handler.cpp', code: httpHandlerCode(`Include ${port.name}'s headers and call it here.`) },
                  { type: 'code', file: 'shell', code: `npx crossbind build -p wasi -e http -b release\nwasmtime serve dist/${httpComponentName('my-service')}` },
                  { type: 'code', file: 'spin.toml', code: spinManifestCode('my-service') },
                  { type: 'code', file: 'shell', code: 'spin up' },
                  { type: 'p', text: `The handler gets each request with its whole body. [Edge](${guideHref('edge')}#http) has what it does and does not do yet.` },
              ]
            : []),
    ];
}

function electronBlocks(port) {
    const napi = publishedTarget(port, NAPI_TARGET);
    if (!napi) return [];
    return [
        {
            type: 'p',
            text: "Electron's main process loads the same Node-API addon as Node.js, with no rebuild for each Electron version. Load it there and hand the window its results over IPC; the window has no Node.js.",
        },
        { type: 'code', file: 'shell', code: install([napi.package]) },
        { type: 'code', file: 'main.js', code: importCode(port, napi) },
        {
            type: 'p',
            text: `A packaged app keeps the addon and its data outside the asar archive, where native code can read them: \`asarUnpack: ['node_modules/@crossbind/**']\` in electron-builder. [Electron](${guideHref('electron')}) has the whole setup.`,
        },
    ];
}

function reactNativeBlocks(port) {
    const mobile = publishedOf(port, ['android', 'ios']);
    if (!mobile.length) return [];
    const ios = mobile.some((variant) => variant.target === 'ios');
    return [
        { type: 'p', text: `Built for ${mobile.map((variant) => `${platformFor(variant.target).label} ${platformFor(variant.target).builds}`).join(', and ')}.` },
        {
            type: 'code',
            file: 'shell',
            code: `${install(['@crossbind/extension-react-native', '@crossbind/extension-react-native-ios', '@crossbind/core-embind-jsi', ...mobile.map((variant) => variant.package)], ['crossbind'])}${ios ? '\ncd ios && pod install' : ''}`,
        },
        { type: 'code', file: 'crossbind.config.mjs', code: configCode(port, mobile) },
        { type: 'code', file: 'metro.config.js', code: METRO_CONFIG },
        { type: 'p', text: `The whole flow, Expo included, is on the [React Native](${guideHref('react-native')}) page.` },
    ];
}

// The library's own command-line tools prebuilt for WASI, then a program of your own on it:
// `main()` in src/native, linked into a native executable or a WASI command, or the prebuilt
// archives in a build that is not crossbind's.
function executableBlocks(port, { programId }) {
    const bin = publishedTarget(port, BIN_TARGET);
    const desktop = publishedOf(port, DESKTOP);
    const wasi = publishedTarget(port, 'wasi');
    if (!bin && !desktop.length && !wasi) return [];
    const own = `a program of your own: \`main(int, char**)\` in \`src/native\`, ${port.name} as a dependency, built as a native executable or a WASI command`;
    const commands = port.binCommands;
    return [
        { type: 'p', text: bin ? `Run ${port.name}'s own command-line tools as they are, or build ${own}.` : `${own.charAt(0).toUpperCase()}${own.slice(1)}.` },
        ...(bin
            ? [
                  { type: 'h3', text: 'Prebuilt tools' },
                  {
                      type: 'p',
                      text: `${commands.length === 1 ? 'One upstream command ships' : `${commands.length} upstream commands ship`} as npm executables built for \`wasm32-wasip3\`. They need \`wasmtime\` on \`PATH\` and no compiler - see [Executables](${guideHref('executables')}#tools).`,
                  },
                  { type: 'code', file: 'shell', code: `npm install --global ${bin.package}${suffix}\n${commands[0]} --help` },
                  ...(commands.length > 1
                      ? [{ type: 'details', summary: `All ${commands.length} commands`, blocks: [{ type: 'p', text: commands.map((command) => `\`${command}\``).join(', ') }] }]
                      : []),
              ]
            : []),
        ...(desktop.length
            ? [
                  { type: 'h3', text: 'Native executables' },
                  { type: 'code', file: 'shell', code: install(desktop.map((variant) => variant.package), ['crossbind']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, desktop) },
                  { type: 'code', file: 'shell', code: 'npx crossbind build -p host -e native -b release\n./dist/<name>.<platform>-<arch>' },
                  { type: 'p', text: "`-p host` builds this machine's platform, `-p linux,linuxmusl,darwin,win32` all four; the musl executable is fully static." },
              ]
            : []),
        ...(wasi
            ? [
                  { type: 'h3', text: 'WASI' },
                  { type: 'code', file: 'shell', code: install([wasi.package], ['crossbind']) },
                  { type: 'code', file: 'crossbind.config.js', code: configCode(port, [wasi]) },
                  { type: 'code', file: 'shell', code: 'npx crossbind build -p wasi -e wasi -b release\nwasmtime run --dir=. .crossbind/build/<name>-wasi-wasm32-st-release.wasm' },
                  ...(programId ? [{ type: 'p', text: `[The command-line tool under Examples](#${programId}) is a whole program built this way.` }] : []),
              ]
            : []),
        ...(desktop.length
            ? [
                  { type: 'h3', text: 'With your own build system' },
                  {
                      type: 'p',
                      text: `Each platform package ships headers, static archives and pkg-config files under \`dist/prebuilt/<platform>-<arch>-mt-release\`: put its \`lib/pkgconfig\` on \`PKG_CONFIG_PATH\`, or the tree on \`CMAKE_PREFIX_PATH\` where upstream installs CMake configs. A C++ library, and anything that links one, needs clang with \`-stdlib=libc++\`. [Executables](${guideHref('executables')}#archives) has the rules.`,
                  },
              ]
            : []),
    ];
}

// The install tabs, by the kind of project the library goes into; a tab with nothing published is left out.
export function installTabs(port, { programId = null, headerImport = null } = {}) {
    return [
        ['Browser', browserBlocks(port, { headerImport })],
        ['Node.js', nodeBlocks(port, { headerImport })],
        ['Edge', edgeBlocks(port)],
        ['Electron', electronBlocks(port)],
        ['React Native', reactNativeBlocks(port)],
        ['Executable', executableBlocks(port, { programId })],
    ]
        .filter(([, blocks]) => blocks.length)
        .map(([label, blocks]) => ({ label, blocks }));
}

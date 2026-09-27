import { REPO_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';

// What changes from one platform to the next for a library: the package, how it is installed and
// configured, and what behaves differently there. The code is the same everywhere else; every
// statement here is either checked by the library modules' builds or taken from docs/api and the
// integration playbooks. Must stay importable from Node with no JSX.

const suffix = RELEASE.distTagSuffix;
const RN_PLAYBOOK = `${REPO_URL}/blob/main/docs/playbooks/integration/react-native-cli.md`;

export const PLATFORMS = [
    { target: 'wasm', label: 'WebAssembly', where: 'browsers, Node.js and edge runtimes', builds: '`wasm32`, single-threaded and multi-threaded' },
    { target: 'android', label: 'Android', where: 'React Native apps on Android', builds: '`arm64-v8a` devices and the `x86_64` emulator' },
    { target: 'ios', label: 'iOS', where: 'React Native apps on iOS', builds: '`arm64` devices and simulators' },
    { target: 'wasi', label: 'WASI', where: 'command-line programs under wasmtime', builds: '`wasm32-wasip3`, single-threaded' },
];

export const platformFor = (target) => PLATFORMS.find((platform) => platform.target === target) ?? null;

const variable = (port, target) => `${port.family.replace(/[^A-Za-z0-9]/g, '')}${target.charAt(0).toUpperCase()}${target.slice(1)}`;

export function configCode(port, targets, extra = '') {
    const imports = targets.map((target) => `import ${variable(port, target.target)} from '${target.package}/crossbind.config.js';`);
    return `${imports.join('\n')}

export default {${extra}
    dependencies: [${targets.map((target) => variable(port, target.target)).join(', ')}],
    paths: { config: import.meta.url },
};`;
}

const METRO_CONFIG = `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const CrossbindMetroPlugin = require('@crossbind/plugin-metro');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
    ...CrossbindMetroPlugin(defaultConfig),
};

module.exports = mergeConfig(defaultConfig, config);`;

// Install and configure one platform variant. `short` leaves out the prose for the overview's tabs;
// `config: false` leaves out the config when the page shows a whole checked project instead.
export function setupBlocks(port, variant, { short = false, config: withConfig = true } = {}) {
    const mobile = variant.target === 'android' || variant.target === 'ios';
    const config = { type: 'code', file: mobile ? 'crossbind.config.mjs' : 'crossbind.config.js', code: configCode(port, [variant]) };
    if (variant.target === 'wasm') {
        return [
            { type: 'code', file: 'shell', code: `npm install ${variant.package}${suffix}` },
            config,
            ...(short
                ? []
                : [
                      {
                          type: 'p',
                          text: `crossbind itself arrives with your bundler plugin, or with a new project from \`npm create crossbind${suffix}\`; [Bundlers](${guideHref('bundlers')}) has Vite, Webpack, Rspack and Rollup.`,
                      },
                  ]),
        ];
    }
    if (mobile) {
        return [
            {
                type: 'code',
                file: 'shell',
                code: `npm install @crossbind/plugin-react-native${suffix} @crossbind/plugin-react-native-ios-helper${suffix} ${variant.package}${suffix}
npm install --save-dev @crossbind/plugin-metro${suffix}${variant.target === 'ios' ? '\ncd ios && pod install' : ''}`,
            },
            config,
            { type: 'code', file: 'metro.config.js', code: METRO_CONFIG },
            ...(short ? [] : [{ type: 'p', text: `The whole flow, including Expo, is in the [React Native playbook](${RN_PLAYBOOK}).` }]),
        ];
    }
    return [{ type: 'code', file: 'shell', code: `npm install ${variant.package}${suffix} crossbind${suffix}` }, ...(withConfig ? [config] : [])];
}

// What behaves differently on a platform, whatever the library.
export function differences(target) {
    switch (target) {
        case 'wasm':
            return [
                "In a browser the module runs in a Worker by default (`useWorker`), so every call returns a promise: `await` calls and constructors alike.",
                `The module has its own filesystem: \`m.FS\` writes files, \`m.getFileBytes\` reads them back and \`m.autoMountFiles\` mounts \`File\` objects from an \`<input type=file>\`. \`/memfs\` lives in memory; \`/opfs\` persists across reloads and needs the Worker. See [Filesystem](${guideHref('filesystem')}).`,
                'In Node.js, `m.FS` is the real disk, so use real paths there.',
                `Multi-threaded builds (\`runtime: 'mt'\`) need COOP and COEP headers in production. See [Threading](${guideHref('threading')}).`,
            ];
        case 'android':
        case 'ios':
            return [
                target === 'android'
                    ? "The React Native plugin compiles your headers with the library inside Gradle's native build, so `npm run android` builds everything."
                    : "`pod install` compiles your headers with the library through the plugin's podspec, and the app build links the result.",
                'Named imports from `./native/<header>.h` work as on the web: `await initNative()` once, then call the classes.',
                "There is no `m.FS` and no `/memfs`: files live in the app's own storage, and your C++ takes their paths.",
                "No Worker and no COOP or COEP: `runtime: 'mt'` uses pthreads directly.",
            ];
        case 'wasi':
            return [
                'There are no JavaScript bindings: `src/native` provides `main(int, char**)`, and the build is a single `.wasm`.',
                'Files come from the host through `--dir` preopens; `--dir=.` gives the program the current directory.',
                '`crossbind build -p wasi -b release` writes the program to `.crossbind/build/<name>-wasi-wasm32-st-release.wasm`.',
                "WASI 0.3's `wasi:cli/exit` carries success or failure only, so any non-zero return from `main` reaches the shell as exit code 1.",
                `The build needs wasi-sdk 34 or newer (\`WASI_SDK_PATH\`) or the crossbind Docker image; running needs wasmtime 47 or newer. See [WASI](${guideHref('wasi')}).`,
            ];
        default:
            return [];
    }
}

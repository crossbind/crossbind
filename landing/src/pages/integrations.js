import { AGENT_URL, DISCUSSIONS_URL, EXAMPLES_URL, INTEGRATIONS_URL, LIBRARIES_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { PORTS } from '../ports/catalog.js';

// /integrations/: the tools crossbind works with, by kind, each with the crossbind packages it takes and a link to the
// guide section that sets it up. Only the one-line summaries are written here, and each says what its guide section
// says: the test checks every link against that page's headings and every package against the repository, so a card
// cannot outlive what it names. IntegrationsPage.jsx lays it out; the blocks below are what search and llms.txt read.

const guide = (slug, anchor) => `${guideHref(slug)}#${anchor}`;

const WEBPACK_PACKAGES = ['@crossbind/plugin-webpack', '@crossbind/plugin-webpack-loader'];
const REACT_NATIVE_PACKAGES = [
    '@crossbind/plugin-react-native', '@crossbind/plugin-react-native-ios-helper', '@crossbind/core-embind-jsi', '@crossbind/plugin-metro',
];

export const INTEGRATION_GROUPS = [
    {
        id: 'bundlers',
        label: 'Bundlers',
        hint: 'A plugin turns the headers and `.rs` files you import into JavaScript modules. It works at the bundler level, beside your framework\'s own plugin, so the framework needs no crossbind package of its own. Without a bundler, the CLI builds a plain script instead.',
        items: [
            {
                id: 'vite',
                name: 'Vite',
                summary: 'Saving a native file rebuilds the wasm and reloads the page. The dev server and `vite preview` send the COOP/COEP headers, so a multithreaded build runs locally as it is.',
                packages: ['@crossbind/plugin-vite'],
                href: guide('bundler-plugins', 'vite'),
            },
            {
                id: 'webpack',
                name: 'Webpack',
                summary: 'The plugin, plus the loader its rule hands headers and `.rs` files to. The config has to be an ES module, such as `webpack.config.mjs`.',
                packages: WEBPACK_PACKAGES,
                href: guide('bundler-plugins', 'webpack'),
            },
            {
                id: 'rspack',
                name: 'Rspack',
                summary: 'The Webpack plugin and its loader, through Rspack\'s webpack-compatible plugin API.',
                packages: WEBPACK_PACKAGES,
                href: guide('bundler-plugins', 'rspack'),
            },
            {
                id: 'rollup',
                name: 'Rollup',
                summary: 'The core the Vite plugin wraps, for a plain Rollup build. There is no dev server: `rollup -c -w` rebuilds the wasm.',
                packages: ['@crossbind/plugin-rollup'],
                href: guide('bundler-plugins', 'rollup'),
            },
            {
                id: 'metro',
                name: 'Metro',
                summary: 'Turns header, `.i` and `.rs` imports into modules and writes the C++ bridge for each header while Metro bundles.',
                packages: ['@crossbind/plugin-metro'],
                href: guide('react-native', 'metro'),
            },
            {
                id: 'no-bundler',
                name: 'No bundler',
                summary: 'The CLI builds a loader and its wasm for a classic `<script>` tag. It binds every header under `src/native`, and nothing rebuilds on save.',
                packages: ['crossbind'],
                href: guide('browser', 'no-bundler'),
            },
        ],
    },
    {
        id: 'mobile-and-desktop',
        label: 'Mobile and desktop',
        hint: 'React Native and Expo apps call your C++ as native code over JSI; Electron loads it as a Node-API addon in its main process.',
        items: [
            {
                id: 'react-native',
                name: 'React Native',
                summary: 'Your C++ runs as native code on iOS and Android, called over JSI. The packages autolink, and the bridges build in Docker or on a remote runner.',
                packages: REACT_NATIVE_PACKAGES,
                href: guide('react-native', 'setup'),
            },
            {
                id: 'expo',
                name: 'Expo',
                summary: 'The same packages and a config plugin in `app.json`. Expo Go cannot load your C++, so the app needs `expo prebuild` and a development build.',
                packages: REACT_NATIVE_PACKAGES,
                href: guide('react-native', 'expo'),
            },
            {
                id: 'electron',
                name: 'Electron',
                summary: 'The main process loads your C++ as a Node-API addon and answers the window over IPC. Node-API is ABI-stable, so nothing rebuilds per Electron version.',
                packages: ['crossbind', '@crossbind/core-embind-napi'],
                href: guide('electron', 'setup'),
            },
        ],
    },
    {
        id: 'runtimes',
        label: 'Runtimes',
        hint: 'Servers, edge isolates and WASI hosts load what the CLI builds for them, with no bundler plugin in between.',
        items: [
            {
                id: 'node',
                name: 'Node.js',
                summary: 'WebAssembly, or a Node-API addon for native memory and system access. Headers import straight into your code through the `crossbind/node/dev` hooks.',
                packages: ['crossbind'],
                href: guide('node', 'which'),
            },
            {
                id: 'cloudflare-workers',
                name: 'Cloudflare Workers',
                summary: 'The Worker imports the loader and its `.wasm` from the build, and Wrangler bundles both with no extra rules. Single-threaded, with files in memory.',
                packages: ['crossbind'],
                href: guide('edge', 'cloudflare-workers'),
            },
            {
                id: 'wasmtime',
                name: 'wasmtime',
                summary: 'Runs C and C++ built as a WASI command, with no JavaScript, and serves a WASI HTTP component with `wasmtime serve`. Needs wasmtime 47 or newer.',
                packages: ['crossbind'],
                href: guide('executables', 'wasi'),
            },
            {
                id: 'spin',
                name: 'Spin',
                summary: 'Serves the same WASI HTTP component from a `spin.toml` manifest with `spin up`. Tested with Spin 4.2.',
                packages: ['crossbind'],
                href: guide('edge', 'http'),
            },
            {
                id: 'wasmcloud',
                name: 'wasmCloud',
                summary: '`wash dev` takes the WASI HTTP component as `build.component_path`. Checked by hand with wash 2.10.',
                packages: ['crossbind'],
                href: guide('edge', 'http'),
            },
        ],
    },
    {
        id: 'registries',
        label: 'Package registries',
        hint: 'Where your native dependencies come from. A crossbind port arrives prebuilt from npm; crates and Conan packages build from source with your project.',
        items: [
            {
                id: 'npm',
                name: 'npm',
                summary: `The crossbind ports, \`@crossbind/port-*\`: ${PORTS.length} C and C++ libraries from GDAL to SQLite, prebuilt from pinned upstream sources. Install one variant per platform you build; your own crossbind packages work the same way.`,
                packages: [],
                href: LIBRARIES_URL,
            },
            {
                id: 'crates-io',
                name: 'crates.io',
                summary: 'Declare a crate in `cargoDependencies` and import it with `cargo:`, with no Rust of your own. Builds for the web, React Native and Node.js addons; not for WASI yet.',
                packages: [],
                href: guide('crates-io', 'declare'),
            },
            {
                id: 'conan',
                name: 'ConanCenter',
                summary: 'Declare a package in `conanDependencies` and import its headers with `conan:`; crossbind builds it from source for each target. Not for WASI.',
                packages: [],
                href: guide('conan', 'declare'),
            },
        ],
    },
    {
        id: 'agents',
        label: 'Coding agents',
        hint: 'One portable skill, installed with the Skills CLI. No background server and no client-specific plugin.',
        items: [
            {
                id: 'skill',
                name: 'crossbind skill',
                summary: 'Teaches a coding agent to check whether crossbind fits, inspect the project, pick the integration and verify the build.',
                packages: [],
                href: AGENT_URL,
            },
        ],
    },
];

export const ANOTHER_TOOL = {
    id: 'another-tool',
    title: 'Another tool',
    text: `A bundler with no plugin here can still drive the build: the plugins only call functions \`crossbind\` exports, and \`@crossbind/plugin-rollup\` is the smallest one to copy. [Another bundler](${guide('bundler-plugins', 'own-plugin')}) lists those functions. For anything else, ask in [Discussions](${DISCUSSIONS_URL}).`,
};

const packagesLine = (packages) => (packages.length ? ` Packages: ${packages.map((name) => `\`${name}\``).join(', ')}.` : '');

export default {
    kind: 'integrations',
    slug: 'integrations',
    title: 'Integrations',
    description: 'The bundlers, mobile and desktop frameworks, runtimes and package registries crossbind works with, each with the crossbind packages it takes and its setup.',
    lede: `The tools crossbind works with, from the bundler in your project to the registry your native code comes from. Each card names the crossbind packages it takes and opens its setup. To start from nothing instead, [Examples](${EXAMPLES_URL}#start) has every create-crossbind template.`,
    section: 'Integrations',
    path: '/integrations',
    href: INTEGRATIONS_URL,
    blocks: [
        ...INTEGRATION_GROUPS.flatMap((group) => [
            { type: 'h2', id: group.id, text: group.label },
            { type: 'p', text: group.hint },
            { type: 'ul', items: group.items.map((item) => `[${item.name}](${item.href}): ${item.summary}${packagesLine(item.packages)}`) },
        ]),
        { type: 'h2', id: ANOTHER_TOOL.id, text: ANOTHER_TOOL.title },
        { type: 'p', text: ANOTHER_TOOL.text },
    ],
};

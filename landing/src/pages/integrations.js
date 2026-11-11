import { AGENT_URL, DISCUSSIONS_URL, INTEGRATIONS_URL, LIBRARIES_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { PORTS } from '../ports/catalog.js';

// /integrations/: the tools crossbind works with, by kind, each with one line of what it does and a link to the guide
// section that sets it up, as /extensions/ lists its extensions. Each line says what its guide section says: the test
// checks every link against that page's headings. IntegrationsPage.jsx lays it out; the blocks below are what search and
// llms.txt read.

const guide = (slug, anchor) => `${guideHref(slug)}#${anchor}`;

export const INTEGRATION_GROUPS = [
    {
        id: 'bundlers',
        label: 'Bundlers',
        items: [
            {
                id: 'vite',
                name: 'Vite',
                summary: 'Saving a native file rebuilds the wasm and reloads the page',
                href: guide('bundler-plugins', 'vite'),
            },
            {
                id: 'webpack',
                name: 'Webpack',
                summary: 'The plugin and its loader, in an ES module config',
                href: guide('bundler-plugins', 'webpack'),
            },
            {
                id: 'rspack',
                name: 'Rspack',
                summary: "The Webpack plugin and its loader, through Rspack's webpack-compatible API",
                href: guide('bundler-plugins', 'rspack'),
            },
            {
                id: 'rollup',
                name: 'Rollup',
                summary: 'The core the Vite plugin wraps, for a plain Rollup build',
                href: guide('bundler-plugins', 'rollup'),
            },
            {
                id: 'metro',
                name: 'Metro',
                summary: 'Turns header, `.i` and `.rs` imports into modules while Metro bundles',
                href: guide('react-native', 'metro'),
            },
            {
                id: 'no-bundler',
                name: 'No bundler',
                summary: 'The CLI builds a loader and its wasm for a classic script tag',
                href: guide('browser', 'no-bundler'),
            },
        ],
    },
    {
        id: 'mobile-and-desktop',
        label: 'Mobile and desktop',
        items: [
            {
                id: 'react-native',
                name: 'React Native',
                summary: 'Your C++ runs as native code on iOS and Android, called over JSI',
                href: guide('react-native', 'setup'),
            },
            {
                id: 'expo',
                name: 'Expo',
                summary: 'The same packages and a config plugin, in a development build, as Expo Go cannot load C++',
                href: guide('react-native', 'expo'),
            },
            { id: 'electron', name: 'Electron', summary: 'The main process loads your C++ as a Node-API addon', href: guide('electron', 'setup') },
        ],
    },
    {
        id: 'runtimes',
        label: 'Runtimes',
        items: [
            {
                id: 'node',
                name: 'Node.js',
                summary: 'WebAssembly, or a Node-API addon for native memory and system access',
                href: guide('node', 'which'),
            },
            {
                id: 'cloudflare-workers',
                name: 'Cloudflare Workers',
                summary: 'The Worker imports the loader and its wasm, and Wrangler bundles both',
                href: guide('edge', 'cloudflare-workers'),
            },
            {
                id: 'wasmtime',
                name: 'wasmtime',
                summary: 'Runs C and C++ built as a WASI command, and serves a WASI HTTP component',
                href: guide('executables', 'wasi'),
            },
            { id: 'spin', name: 'Spin', summary: 'Serves the same WASI HTTP component with `spin up`', href: guide('edge', 'http') },
            { id: 'wasmcloud', name: 'wasmCloud', summary: 'Serves the same WASI HTTP component with `wash dev`', href: guide('edge', 'http') },
        ],
    },
    {
        id: 'registries',
        label: 'Package registries',
        items: [
            {
                id: 'npm',
                name: 'npm',
                summary: `The crossbind ports: ${PORTS.length} C and C++ libraries, prebuilt from pinned upstream sources`,
                href: LIBRARIES_URL,
            },
            {
                id: 'crates-io',
                name: 'crates.io',
                summary: 'Crates declared in `cargoDependencies` and imported with `cargo:`',
                href: guide('crates-io', 'declare'),
            },
            {
                id: 'conan',
                name: 'ConanCenter',
                summary: 'Packages declared in `packages.conan`, built from source for each target',
                href: guide('conan', 'declare'),
            },
        ],
    },
    {
        id: 'agents',
        label: 'Coding agents',
        items: [
            {
                id: 'skill',
                name: 'crossbind skill',
                summary: 'Teaches a coding agent to check the fit, pick the integration and verify the build',
                href: AGENT_URL,
            },
        ],
    },
];

export default {
    kind: 'integrations',
    slug: 'integrations',
    title: 'Integrations',
    description: 'The bundlers, mobile and desktop frameworks, runtimes and package registries crossbind works with, each opening its setup.',
    lede: 'The tools crossbind works with, from the bundler in your project to the registry your native code comes from.',
    section: 'Integrations',
    path: '/integrations',
    href: INTEGRATIONS_URL,
    blocks: [
        ...INTEGRATION_GROUPS.flatMap((group) => [
            { type: 'h2', id: group.id, text: group.label },
            { type: 'ul', items: group.items.map((item) => `[${item.name}](${item.href}): ${item.summary}`) },
        ]),
        {
            type: 'p',
            text: `A bundler with no plugin here can still drive the build: [Another bundler](${guide('bundler-plugins', 'own-plugin')}) lists the functions a plugin calls. For anything else, ask in [Discussions](${DISCUSSIONS_URL}).`,
        },
    ],
};

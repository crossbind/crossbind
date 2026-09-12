import { REPO_URL } from '../data.js';
import { formatPublishedAt } from '../changelog/format.js';
import { RELEASE } from '../release.js';

// /examples/: the examples that were actually run from the published npm packages - scaffolded
// with the site's create command, installed from the registry (no workspace links), built with
// the pinned toolchain and exercised on a real machine. The page shows what a visitor needs to
// repeat the run; the date and version are the record's, not the live snapshot's, and
// ExamplesPage.jsx says so when the current release has moved on. The full record (resolved
// versions, environment) lives in the repository notes, not here.

export const EXAMPLES_VERIFIED_ON = '2026-09-11';
export const EXAMPLES_VERIFIED_AGAINST = '2.0.0-beta.56';
// The creator that produced the projects (npm `beta` on the day) and the exact tag its templates
// come from; source links point there, so what a reader opens is what was run.
export const EXAMPLES_CREATOR = 'create-crossbind@2.0.0-beta.57';
export const EXAMPLES_SOURCE_REF = 'create-crossbind@2.0.0-beta.57';

// Same shape as the Quick Start: the channel suffix follows the resolved release.
const creator = `npm create crossbind${RELEASE.distTagSuffix}`;
const suffix = RELEASE.distTagSuffix;
const example = (name) => `${REPO_URL}/tree/${EXAMPLES_SOURCE_REF}/examples/${name}`;
const port = (name) => `${REPO_URL}/tree/crossbind@${EXAMPLES_VERIFIED_AGAINST}/ports/${name}`;

const MATRIX_LINE = '`Matrix multiplier with c++ => J₃ * (2*J₃) = 6*J₃`';

// Every web variant renders the same C++ result; what differs is the bundler and the preview
// command. `preview` is what the template's own script does.
const webVariant = ({ id, label, args, dir, preview, previewNote }) => ({
    id,
    label,
    create: `${creator} -- ${dir} ${args}`,
    steps: `cd ${dir}
npm install
npm run build
npm run preview
# ${previewNote}`,
    expected: `The page shows ${MATRIX_LINE}, computed in C++. \`npm run e2e:prod\` checks that string in chromium, firefox and webkit (\`3 passed\`).`,
    source: example(id),
    preview,
});

export const EXAMPLES = [
    {
        id: 'web',
        glyph: 'chrome',
        tone: '#5ba3e3',
        title: 'Web',
        summary:
            'A browser app that calls C++ through the plugin for your bundler. Pick the framework and bundler you use; the C++ and the result are the same.',
        needs: 'Node.js 24+, Docker (the toolchain image is pulled on the first build) and Playwright browsers for the e2e step.',
        variants: [
            webVariant({
                id: 'web-react-vite',
                label: 'React · Vite',
                args: 'Web React Vite',
                dir: 'my-app',
                preview: 'vite',
                previewNote: 'open http://localhost:4173',
            }),
            webVariant({
                id: 'web-vue-vite',
                label: 'Vue · Vite',
                args: 'Web Vue Vite',
                dir: 'my-app',
                preview: 'vite',
                previewNote: 'open http://localhost:4173',
            }),
            webVariant({
                id: 'web-svelte-vite',
                label: 'Svelte · Vite',
                args: 'Web Svelte Vite',
                dir: 'my-app',
                preview: 'vite',
                previewNote: 'open http://localhost:4173',
            }),
            webVariant({
                id: 'web-react-rspack',
                label: 'React · Rspack',
                args: 'Web React Rspack',
                dir: 'my-app',
                preview: 'serve',
                previewNote: 'open the URL serve prints',
            }),
            webVariant({
                id: 'web-vanilla',
                label: 'Vanilla',
                args: 'Web Vanilla',
                dir: 'my-app',
                preview: 'serve',
                previewNote: 'open the URL serve prints',
            }),
        ],
    },
    {
        id: 'backend-nodejs-wasm',
        glyph: 'node',
        tone: '#5FA04E',
        title: 'Node.js',
        summary: 'A Node.js script that boots the generated module and calls a C++ class; no bundler, the CLI builds the wasm.',
        create: `${creator} -- my-node Backend Node.js WebAssembly`,
        needs: 'Node.js 24+ and Docker.',
        steps: `cd my-node
npm install
npm run build
node src/index.mjs`,
        expected: `\`npm run build\` runs \`crossbind build -p wasm -a wasm32 -r st -e node -b release\` and writes \`dist/*.node.js\` + \`dist/*.node.wasm\`; the script prints ${MATRIX_LINE}.`,
        source: example('backend-nodejs-wasm'),
    },
    {
        id: 'cloud-cloudflare-worker',
        glyph: 'cf',
        tone: '#F6821F',
        title: 'Cloudflare Worker',
        summary: 'A Worker that answers HTTP requests from C++; the same wasm, single-threaded, in-memory filesystem.',
        create: `${creator} -- my-worker Cloud "Cloudflare Worker"`,
        needs: 'Node.js 24+, Docker, and wrangler for the local run.',
        steps: `cd my-worker
npm install
npm run build
npx wrangler dev --port 8787
# in a second terminal
curl http://localhost:8787/`,
        expected:
            '`npm run build` writes `dist/*.edge.js` + `dist/*.edge.wasm`; `wrangler dev` reports `Ready on http://localhost:8787` and the request returns `Hello World, greetings from c++.` with status 200.',
        source: example('cloud-cloudflare-worker'),
    },
    {
        id: 'mobile-reactnative-expo',
        glyph: 'rn',
        tone: '#61DAFB',
        title: 'React Native (Expo)',
        summary: 'An Expo app calling the same C++ over JSI as native machine code; no wasm on the phone. One project, both platforms.',
        needs: 'Node.js 24+ and the platform toolchain below.',
        variants: [
            {
                id: 'mobile-reactnative-expo',
                label: 'iOS',
                create: `${creator} -- my-app Mobile "React Native" Expo`,
                needs: 'Node.js 24+, Xcode with an iOS simulator, and CocoaPods.',
                steps: `cd my-app
npm install
npm run run:ios`,
                expected: `\`run:ios\` runs \`expo run:ios --configuration Release\`: it generates the native project, installs the pods, builds the app and starts it on the simulator; the screen shows ${MATRIX_LINE}.`,
                source: example('mobile-reactnative-expo'),
            },
            {
                id: 'mobile-reactnative-expo-android',
                label: 'Android',
                create: `${creator} -- my-app Mobile "React Native" Expo`,
                needs: 'Node.js 24+, JDK 17, and the Android SDK with an NDK; an emulator running or a device connected.',
                steps: `cd my-app
npm install
npm run run:android`,
                expected: `\`run:android\` runs \`expo run:android --variant release\`: it generates the native project, builds the app with Gradle and starts it on the device; the screen shows ${MATRIX_LINE}.`,
                source: example('mobile-reactnative-expo'),
            },
        ],
    },
    {
        id: 'wasi-tools',
        glyph: 'wasi',
        tone: '#a78bfa',
        title: 'WASI tools',
        summary: 'Upstream GDAL command-line tools as npm executables, run by wasmtime: no compiler, no toolchain image, nothing to build.',
        create: `npm install --global @crossbind/port-gdal-bin-wasi${suffix}`,
        needs: 'wasmtime 47+ on PATH; Node.js only for npm itself.',
        steps: `gdalinfo-wasi --version
ogrinfo-wasi --formats`,
        expected:
            '`gdalinfo-wasi --version` prints `GDAL 3.13.3 "Iowa City", released 2026/08/13`; `ogrinfo-wasi --formats` lists the drivers, starting with `MEM`, `PCIDSK` and `PDF`.',
        source: port('gdal'),
    },
];

// Search and llms.txt read the same content as blocks; the page renders it with its own layout.
const entryBlocks = (entry) => [
    ...(entry.needs ? [{ type: 'p', text: `Needs ${entry.needs}` }] : []),
    { type: 'code', file: 'shell', code: entry.create },
    { type: 'code', file: 'shell', code: entry.steps },
    { type: 'callout', tone: 'note', title: 'Expected result', text: entry.expected },
    {
        type: 'p',
        text: `Source: [${entry.source.split('/').slice(-2).join('/')}](${entry.source}) at the tag the verified creator was published from.`,
    },
];

export default {
    kind: 'examples',
    slug: 'examples',
    title: 'Examples',
    kicker: 'VERIFIED',
    description: `Examples run end to end from the published packages on ${formatPublishedAt(EXAMPLES_VERIFIED_ON)}: web apps for five bundler and framework combinations, a Node.js backend, a Cloudflare Worker, a React Native app on iOS and Android, and WASI command tools, all on crossbind ${EXAMPLES_VERIFIED_AGAINST}.`,
    lede: `Run C++ inside a browser app, a Node.js service, a Cloudflare Worker, a React Native app or a command-line tool. Each example is created with the site's own command, installed from npm, built and run; the commands and the output they produced are recorded as they happened.`,
    section: 'Examples',
    path: '/examples',
    href: '/examples/',
    eyebrow: { head: 'EXAMPLES', tail: ` · verified ${EXAMPLES_VERIFIED_ON}` },
    blocks: EXAMPLES.flatMap((entry) => [
        { type: 'h2', id: entry.id, text: entry.title },
        { type: 'p', text: `${entry.summary} Needs ${entry.needs}` },
        ...(entry.variants
            ? entry.variants.flatMap((variant) => [{ type: 'h3', text: variant.label }, ...entryBlocks(variant)])
            : entryBlocks({ ...entry, needs: null })),
    ]),
};

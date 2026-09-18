import { formatPublishedAt } from '../changelog/format.js';
import { changelogHref } from '../changelog/route.js';
import {
    AGENT_URL,
    BRAND,
    CREATE_COMMAND,
    EXAMPLES_URL,
    FEATURE_EXTRAS,
    FEATURE_GROUPS,
    FEATURES,
    installCommand,
    LIBRARIES_URL,
    RUNTIME_CHIPS,
    SCAFFOLD_BUNDLERS,
    SCAFFOLD_FRAMEWORKS,
    SCAFFOLD_TARGETS,
    SHOWCASE,
    SHOWCASE_COUNT,
    SITE,
    SITE_DESCRIPTION,
    SKILL_COMMAND,
    spell,
} from '../data.js';
import { guideHref } from '../guide/nav.js';
import EXAMPLES_PAGE from '../pages/examples.js';
import { RELEASE } from '../release.js';
import { LIMITS, WHY_POINTS } from '../why.js';

export const SUMMARY = `${BRAND} builds and packages C++ and Rust for JavaScript applications, generating the bindings from the header `
    + 'or crate you already own. It produces WebAssembly for browsers, Node.js and Cloudflare Workers, and native iOS and Android '
    + 'libraries for React Native. A separate C/C++ target produces WASI command components that run without a JavaScript host; '
    + 'Rust is not supported on that target yet.';

// The facts an agent gets wrong most often, kept in front of both llms files.
export const ESSENTIALS = [
    'Browser, Node.js and edge builds are WebAssembly with a target-specific JavaScript loader; React Native runs native iOS and '
        + 'Android libraries through JSI, and Expo needs a development build.',
    'WASI is a separate C/C++ command target: no JavaScript host, no `initNative()`, a WASI runtime such as wasmtime 47+ required, '
        + 'and no Rust yet.',
    'A prebuilt port skips compiling the upstream library; your own code, the generated bindings and the final link still go '
        + 'through the build toolchain, and you install one platform variant per target you build.',
    '`crossbind.config.js` is build-time configuration and `initNative(opts)` is runtime configuration; await `initNative()`, and '
        + 'with `useWorker: true` await every call.',
    "Browser multithreading (`runtime: 'mt'`) needs COOP/COEP headers in production; `useWorker` is an independent choice that "
        + "crossbind's OPFS integration requires.",
];

export function releaseLine() {
    const scaffolder = RELEASE.companions['create-crossbind'];
    const install = RELEASE.distTagSuffix
        ? ` Install every ${BRAND} package, ports included, with the \`${RELEASE.distTagSuffix}\` suffix; the default npm tag is older.`
        : '';
    return `Documentation snapshot resolved on ${formatPublishedAt(RELEASE.resolvedAt)}: ${BRAND} ${RELEASE.version} `
        + `(${RELEASE.channel} channel, npm dist-tag \`${RELEASE.distTag}\`), published ${formatPublishedAt(RELEASE.publishedAt)} `
        + `([changelog](${SITE}${changelogHref(RELEASE.version)})); scaffolder create-crossbind ${scaffolder.version}.${install} `
        + 'Packages are versioned independently: pin exact versions and keep the lockfile for a setup you can reproduce.';
}

const lowerFirst = (text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const capabilityBlocks = FEATURE_GROUPS.flatMap((group) => [
    { type: 'h3', text: `${group.label}: ${lowerFirst(group.hint)}` },
    {
        type: 'ul',
        items: FEATURES
            .filter((feature) => feature.group === group.id)
            .map((feature) => `**${feature.title}** - ${feature.summary} ([guide](${guideHref(feature.guide)}))`),
    },
]);

// The home page as a document: what the hero, the runtime strip, the scaffolder, the capability
// matrix and the library showcase say, in the same order.
export const OVERVIEW_PAGE = {
    title: BRAND,
    description: SITE_DESCRIPTION,
    path: '/',
    href: '/',
    lede: SUMMARY,
    blocks: [
        { type: 'p', text: releaseLine() },

        { type: 'h2', text: 'Start' },
        {
            type: 'p',
            text: 'A new project: the scaffolder asks for a name, a target, a framework and a bundler and prints a working repo '
                + `with a sample C++ binding already wired. Frameworks: ${SCAFFOLD_FRAMEWORKS.join(', ')}. `
                + `Bundlers: ${SCAFFOLD_BUNDLERS.join(', ')}. Targets: ${SCAFFOLD_TARGETS.map((target) => target.label).join(', ')}.`,
        },
        { type: 'code', file: 'shell', code: CREATE_COMMAND },
        {
            type: 'p',
            text: 'An existing app: install the plugin for your bundler, add a two-line `crossbind.config.js`, import a header '
                + `from JavaScript and call \`initNative()\` once. Both paths are in the [quick start](${guideHref('quick-start')}).`,
        },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/plugin-vite') },
        {
            type: 'p',
            text: `With a coding agent: install the ${BRAND} skill once, then ask the agent to add ${BRAND}; see [Agent setup](${AGENT_URL}).`,
        },
        { type: 'code', file: 'shell', code: SKILL_COMMAND },

        { type: 'h2', text: `Same code, ${spell(RUNTIME_CHIPS.length)} runtimes` },
        { type: 'ul', items: RUNTIME_CHIPS.map((chip) => `**${chip.label}** - ${chip.sub}`) },

        { type: 'h2', text: `Why ${BRAND}` },
        { type: 'ul', items: WHY_POINTS.map(([title, text]) => `**${title}** - ${text}`) },

        { type: 'h2', text: 'Good to know' },
        { type: 'ul', items: LIMITS },

        { type: 'h2', text: 'Capabilities' },
        ...capabilityBlocks,
        { type: 'p', text: `Smaller details: ${FEATURE_EXTRAS.join(', ')}.` },

        { type: 'h2', text: 'Prebuilt libraries' },
        {
            type: 'p',
            text: `${SHOWCASE_COUNT} C++ libraries ship as \`@crossbind/port-*\` packages compiled from pinned upstream sources; `
                + `the catalog is at [Libraries](${LIBRARIES_URL}). The most used:`,
        },
        { type: 'ul', items: SHOWCASE.map((item) => `[${item.name}](${item.href}) - ${item.desc} (${item.tag})`) },

        { type: 'h2', text: 'Verified examples' },
        { type: 'p', text: `${EXAMPLES_PAGE.description} See [Examples](${EXAMPLES_URL}).` },
    ],
};

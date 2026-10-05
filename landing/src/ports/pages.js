import LIBRARY_EXAMPLES from '../../generated/library-examples.js';
import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';
import { BIN_TARGET, PORTS, PORTS_CATALOG, publishedLibraryTargets, publishedTarget, TARGET_LABELS, WASI_TOOL_PORTS } from './catalog.js';
import { differences, PLATFORMS, platformFor, setupBlocks } from './platforms.js';

// /ports/, /ports/<family>/ and /ports/<family>/<platform>/ as guide-shaped pages. Every fact comes
// from the generated catalog and the checked usage examples; the prose here only frames them. Must
// stay importable from Node with no JSX.

export const PORTS_BASE = '/ports';
export const PORTS_INDEX_HREF = `${PORTS_BASE}/`;
export const portHref = (family) => `${PORTS_BASE}/${family}/`;
export const platformHref = (family, target) => `${PORTS_BASE}/${family}/${target}/`;

const suffix = RELEASE.distTagSuffix;
const distTag = PORTS_CATALOG.distTag;

// The published variants that have a platform page, in the order the pages list them.
const platformVariants = (port) =>
    PLATFORMS.map((platform) => publishedLibraryTargets(port).find((variant) => variant.target === platform.target)).filter(Boolean);

function packagesTable(port) {
    const rows = [['Meta package', `\`${port.npm}\``, port.published ? `\`${port.published}\`` : 'not published']];
    for (const target of port.targets) {
        rows.push([
            TARGET_LABELS[target.target] ?? target.target,
            `\`${target.package}\``,
            target.published ? `\`${target.published}\`` : 'not published',
        ]);
    }
    return { type: 'table', head: ['Target', 'Package', `npm \`${distTag}\``], rows };
}

// The overview's install chip shows the WebAssembly variant, the common first step.
const shownVariant = (port) => {
    const variants = publishedLibraryTargets(port);
    return variants.find((variant) => variant.target === 'wasm') ?? variants[0] ?? null;
};

const examplesOf = (port) => LIBRARY_EXAMPLES[port.family] ?? null;

// How much of the page works with no C++: the examples whose JavaScript-only version runs. Those
// versions are built and checked in WebAssembly, so only the pages that run examples show them.
function directSummary(port, library) {
    const runs = library.examples.filter((example) => example.direct && !example.direct.impossible).length;
    const total = library.examples.length;
    const rest = total - runs === 1 ? 'the other says what stops it' : 'the others say what stops them';
    const tally =
        runs === total ? `All ${total} work that way.` : runs === 0 ? 'None of them work that way; each tab says what stops it.' : `${runs} of ${total} work that way; ${rest}.`;
    return `Each example also has a **JavaScript only** tab: the same task with no C++ file, calling ${port.name}'s own headers from \`${port.npm}\` directly. ${tally}`;
}

const showsDirect = (platform) => !platform || platform.target === 'wasm';

function exampleBlocks(port, { runnable, platform = null }) {
    const library = examplesOf(port);
    if (!library) return [];
    const shown = platform && platform.target !== 'wasm' ? library.examples.filter((example) => !example.webOnly) : library.examples;
    const left = library.examples.filter((example) => !shown.includes(example));
    const direct = showsDirect(platform) ? library.direct : null;
    const config = direct?.config?.length
        ? [
              { type: 'p', text: 'Imported straight from JavaScript, the headers need this configuration today; its comments say why.' },
              ...direct.config.map(({ file, code }) => ({ type: 'code', file, code })),
          ]
        : [];
    return [
        ...(direct ? [{ type: 'p', text: directSummary(port, library) }, ...config] : []),
        ...shown.map((example) => ({ type: 'example', demo: library.demo, example, runnable, direct })),
        ...(left.length
            ? [
                  {
                      type: 'p',
                      text: `${left.map((example) => `"${example.title}"`).join(', ')} ${left.length === 1 ? 'writes its input' : 'write their input'} with \`m.FS\`, which ${platform.label} does not have; the C++ takes paths, so it works unchanged on files in the app's storage. It runs on [the WebAssembly page](${platformHref(port.family, 'wasm')}).`,
                  },
              ]
            : []),
    ];
}

function usageBlocks(port) {
    const library = examplesOf(port);
    if (!library) return [];
    return [
        { type: 'h2', id: 'usage', text: 'Usage' },
        {
            type: 'p',
            text: `The calls most ${port.name} code makes, each a small C++ header crossbind binds and the JavaScript that uses it. Every example runs here in WebAssembly and prints what the site build checked; the same headers and calls work on [Android](${platformHref(port.family, 'android')}) and [iOS](${platformHref(port.family, 'ios')}).`,
        },
        ...exampleBlocks(port, { runnable: true }),
    ];
}

function addBlocks(port) {
    const variants = platformVariants(port);
    if (!variants.length || !port.published) return [];
    return [
        { type: 'h2', id: 'install', text: 'Add it to your project' },
        {
            type: 'p',
            text: `One package per platform: install the ones you build for and list each in \`crossbind.config.js\`; crossbind compiles only the one that matches the build target. Your C++ goes in \`src/native\`, next to the headers it binds. [Libraries](${guideHref('libraries')}) explains the whole flow.`,
        },
        {
            type: 'tabs',
            tabs: variants.map((variant) => ({ label: platformFor(variant.target).label, blocks: setupBlocks(port, variant, { short: true }) })),
        },
    ];
}

function platformsBlocks(port) {
    const variants = platformVariants(port);
    if (!variants.length) return [];
    const bin = publishedTarget(port, BIN_TARGET);
    return [
        { type: 'h2', id: 'platforms', text: 'Platforms' },
        {
            type: 'table',
            head: ['Platform', 'Runs in', 'Builds', 'Page'],
            rows: variants.map((variant) => {
                const platform = platformFor(variant.target);
                const where = variant.target === 'wasi' && bin ? `${platform.where}, plus \`${port.binCommands.join('`, `')}\` as npm commands` : platform.where;
                return [platform.label, where, platform.builds, `[${port.name} for ${platform.label}](${platformHref(port.family, variant.target)})`];
            }),
        },
    ];
}

function toolBlocks(port) {
    const bin = publishedTarget(port, BIN_TARGET);
    if (!bin) return [];
    return [
        { type: 'h2', id: 'commands', text: 'Command-line tools' },
        {
            type: 'p',
            text: `${port.binCommands.length === 1 ? 'One upstream command ships' : `${port.binCommands.length} upstream commands ship`} as npm executables built for \`wasm32-wasip3\`. They need \`wasmtime\` on \`PATH\` and no compiler - see [WASI commands](${guideHref('wasi')}).`,
        },
        { type: 'code', file: 'shell', code: `npm install --global ${bin.package}${suffix}\n${port.binCommands[0]} --help` },
        { type: 'ul', items: port.binCommands.map((command) => `\`${command}\``) },
    ];
}

function licenceBlocks(port) {
    const items = [`npm \`license\` field of \`${port.npm}\`: \`${port.license}\`.`];
    if (port.upstreamLicense && port.upstreamLicense !== port.license)
        items.push(`Upstream declares \`${port.upstreamLicense}\`; the npm field normalises it to SPDX.`);
    if (publishedTarget(port, BIN_TARGET)) {
        items.push(
            'The `-standalone-wasi` package lists every statically linked component in its own `license` field, which is longer than the library licence above.',
        );
    }
    items.push(`The licence files that ship with the package, and the port recipe, are in [the port directory](${port.repositoryUrl}).`);
    return [
        { type: 'h2', id: 'licence', text: 'Licence' },
        { type: 'ul', items },
    ];
}

const platformLinks = (port) =>
    platformVariants(port).map((variant) => ({ target: variant.target, label: platformFor(variant.target).label, href: platformHref(port.family, variant.target) }));

function detailPage(port) {
    const targets = publishedLibraryTargets(port).map((target) => TARGET_LABELS[target.target]);
    return {
        kind: 'port',
        slug: port.family,
        title: port.name,
        description: `${port.summary}. Prebuilt for ${targets.length ? targets.join(', ') : 'no published target yet'}.`,
        lede: `${port.name} ${port.nativeVersion}, ${port.summary.charAt(0).toLowerCase()}${port.summary.slice(1)}, packaged by crossbind as \`${port.npm}\` and one package per target. Only a variant that is actually on npm \`${distTag}\` is listed as published.`,
        section: 'Libraries',
        path: `${PORTS_BASE}/${port.family}`,
        href: portHref(port.family),
        port,
        platforms: platformLinks(port),
        install: port.published && shownVariant(port) ? `npm install ${shownVariant(port).package}${suffix}` : null,
        links: [
            { label: 'npm', href: `https://www.npmjs.com/package/${port.npm}`, external: true },
            { label: 'Port recipe and licence files', href: port.repositoryUrl, external: true },
            { label: `Upstream source ${port.nativeVersion}`, href: port.upstreamSource, external: true },
            { label: 'Libraries guide', href: guideHref('libraries') },
            { label: 'WASI commands guide', href: guideHref('wasi') },
        ],
        blocks: [
            ...usageBlocks(port),
            ...addBlocks(port),
            ...platformsBlocks(port),
            { type: 'h2', id: 'packages', text: 'Packages' },
            packagesTable(port),
            ...licenceBlocks(port),
        ],
    };
}

function wasiProgramBlocks(port) {
    const wasi = examplesOf(port)?.wasi;
    if (!wasi) return [];
    return [
        { type: 'h2', id: 'program', text: wasi.title },
        { type: 'p', text: wasi.summary },
        { type: 'code', file: 'crossbind.config.js', code: wasi.config },
        { type: 'code', file: wasi.sourceFile, code: wasi.source },
        { type: 'code', file: 'shell', code: wasi.commands.join('\n') },
        { type: 'code', file: 'output', code: wasi.expected.join('\n') },
    ];
}

function platformUsageBlocks(port, platform) {
    if (platform.target === 'wasi') return wasiProgramBlocks(port);
    const library = examplesOf(port);
    if (!library) return [];
    const intro =
        platform.target === 'wasm'
            ? 'Each example runs here, in this tab, and prints what the site build checked.'
            : `The examples the [WebAssembly page](${platformHref(port.family, 'wasm')}) runs, as ${platform.label} compiles them: the same headers and the same calls. They are checked on the WebAssembly build.`;
    return [{ type: 'h2', id: 'usage', text: 'Usage' }, { type: 'p', text: intro }, ...exampleBlocks(port, { runnable: platform.target === 'wasm', platform })];
}

function platformPage(port, variant) {
    const platform = platformFor(variant.target);
    const others = platformVariants(port).filter((other) => other.target !== variant.target);
    return {
        kind: 'port-platform',
        slug: `${port.family}/${variant.target}`,
        title: `${port.name} for ${platform.label}`,
        description: `${port.name} ${port.nativeVersion} for ${platform.where}: install, configure and use \`${variant.package}\`.`,
        lede: `${port.name} ${port.nativeVersion} for ${platform.where}, precompiled for ${platform.builds} as \`${variant.package}\`.`,
        section: 'Libraries',
        path: `${PORTS_BASE}/${port.family}/${variant.target}`,
        href: platformHref(port.family, variant.target),
        port,
        platform,
        platforms: platformLinks(port),
        install: `npm install ${variant.package}${suffix}`,
        links: [
            { label: 'npm', href: `https://www.npmjs.com/package/${variant.package}`, external: true },
            { label: 'Port recipe and licence files', href: port.repositoryUrl, external: true },
        ],
        blocks: [
            { type: 'h2', id: 'install', text: 'Install' },
            // A WASI page with a checked program shows that program's config instead of a bare one.
            ...setupBlocks(port, variant, { config: !(variant.target === 'wasi' && examplesOf(port)?.wasi) }),
            ...platformUsageBlocks(port, platform),
            ...(variant.target === 'wasi' ? toolBlocks(port) : []),
            { type: 'h2', id: 'differences', text: `What is different on ${platform.label}` },
            { type: 'ul', items: differences(variant.target) },
            { type: 'h2', id: 'other-platforms', text: 'Other platforms' },
            {
                type: 'ul',
                items: [
                    `[${port.name} overview](${portHref(port.family)}): the apps, every platform's setup and the packages.`,
                    ...others.map((other) => `[${port.name} for ${platformFor(other.target).label}](${platformHref(port.family, other.target)}): ${platformFor(other.target).where}.`),
                ],
            },
        ],
    };
}

export const PORT_PAGES = PORTS.map(detailPage);

export const PORT_PLATFORM_PAGES = PORTS.flatMap((port) => platformVariants(port).map((variant) => platformPage(port, variant)));

const librariesCount = PORTS.filter((port) => publishedLibraryTargets(port).length).length;

export const PORTS_INDEX = {
    kind: 'ports-index',
    slug: '',
    title: 'Libraries',
    description: `${librariesCount} C and C++ libraries prebuilt for the web, Node.js, iOS, Android and WASI, plus the command-line tools of ${WASI_TOOL_PORTS.length} of them as npm executables.`,
    lede: `Every library here is compiled from its pinned upstream source and published as \`@crossbind/port-*\` packages on the npm \`${distTag}\` tag. Pick one, install it, import its header.`,
    section: 'Libraries',
    path: PORTS_BASE,
    href: PORTS_INDEX_HREF,
    eyebrow: { head: 'LIBRARIES', tail: '' },
    blocks: [
        {
            type: 'p',
            text: `The list is generated from the port manifests in the repository and from what npm serves on \`${distTag}\` at build time; a target counts only when its package is published. Categories, versions and licences come from the same sources as the [agent skill's catalog](${guideHref('libraries')}).`,
        },
    ],
};

export const PORTS_ROUTES = [PORTS_INDEX.href, ...PORT_PAGES.map((page) => page.href), ...PORT_PLATFORM_PAGES.map((page) => page.href)];

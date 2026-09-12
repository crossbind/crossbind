import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';
import {
    BIN_TARGET,
    CATEGORY_LABELS,
    PORTS,
    PORTS_CATALOG,
    publishedLibraryTargets,
    publishedTarget,
    TARGET_LABELS,
    WASI_TOOL_PORTS,
} from './catalog.js';

// /ports/ and /ports/<family>/ as guide-shaped pages. Every fact comes from the generated
// catalog; the prose here only frames it. Must stay importable from Node with no JSX.

export const PORTS_BASE = '/ports';
export const PORTS_INDEX_HREF = `${PORTS_BASE}/`;
export const portHref = (family) => `${PORTS_BASE}/${family}/`;

const suffix = RELEASE.distTagSuffix;
const distTag = PORTS_CATALOG.distTag;

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

function installBlocks(port) {
    const variants = publishedLibraryTargets(port);
    if (!variants.length || !port.published) return [];
    // One package per platform, each with its own config; the wasm one is the common case.
    const shown = variants.find((variant) => variant.target === 'wasm') ?? variants[0];
    const identifier = `${port.family}${shown.target.charAt(0).toUpperCase()}${shown.target.slice(1)}`;
    const others = variants.filter((variant) => variant !== shown).map((variant) => `\`${variant.package}\``);
    return [
        { type: 'h2', id: 'install', text: 'Install' },
        {
            type: 'p',
            text: `Install the variant for the platform you build, declare it as a dependency in \`crossbind.config.js\` and import the header from JavaScript. Nothing is compiled on your machine. ${others.length ? `A project that builds for several platforms lists one variant per platform: ${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} published too.` : 'This is the only published variant.'}`,
        },
        { type: 'code', file: 'shell', code: `npm install ${shown.package}${suffix}` },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import ${identifier} from '${shown.package}/crossbind.config.js';

export default {
    dependencies: [${identifier}],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: `Header import paths are relative to the package's \`dist/prebuilt/<target>/include\`, so \`${port.npm}/<header>.h\` is upstream's own header. The full flow, including what the meta package is for, is in [the Libraries guide](/guide/libraries/).`,
        },
    ];
}

function toolBlocks(port) {
    const bin = publishedTarget(port, BIN_TARGET);
    if (!bin) return [];
    return [
        { type: 'h2', id: 'commands', text: 'WASI command tools' },
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
            'The `-bin-wasi` package lists every statically linked component in its own `license` field, which is longer than the library licence above.',
        );
    }
    items.push(`The licence files that ship with the package, and the port recipe, are in [the port directory](${port.repositoryUrl}).`);
    return [
        { type: 'h2', id: 'licence', text: 'Licence' },
        { type: 'ul', items },
    ];
}

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
        install: port.published && publishedLibraryTargets(port).length ? `npm install ${port.npm}${suffix}` : null,
        links: [
            { label: 'npm', href: `https://www.npmjs.com/package/${port.npm}`, external: true },
            { label: 'Port recipe and licence files', href: port.repositoryUrl, external: true },
            { label: `Upstream source ${port.nativeVersion}`, href: port.upstreamSource, external: true },
            { label: 'Libraries guide', href: guideHref('libraries') },
            { label: 'WASI commands guide', href: guideHref('wasi') },
        ],
        blocks: [
            { type: 'h2', id: 'packages', text: 'Packages' },
            packagesTable(port),
            ...installBlocks(port),
            ...toolBlocks(port),
            ...licenceBlocks(port),
        ],
    };
}

export const PORT_PAGES = PORTS.map(detailPage);

const librariesCount = PORTS.filter((port) => publishedLibraryTargets(port).length).length;

export const PORTS_INDEX = {
    kind: 'ports-index',
    slug: '',
    title: 'Libraries',
    description: `${librariesCount} C++ libraries prebuilt for the web, Node.js, iOS, Android and WASI, and ${WASI_TOOL_PORTS.length} of their command-line tools as npm executables.`,
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

export const PORTS_ROUTES = [PORTS_INDEX.href, ...PORT_PAGES.map((page) => page.href)];

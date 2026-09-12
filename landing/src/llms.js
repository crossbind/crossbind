import { CHANGELOG_PAGE } from './changelog/page.js';
import { changelogHref } from './changelog/route.js';
import { AGENT_URL, API_URL, DISCUSSIONS_URL, EXAMPLES_URL, LICENSE_URL, LIBRARIES_URL, REPO_URL, SITE } from './data.js';
import { DEMOS } from './demos.js';
import { GUIDE_PAGES } from './guide/nav.js';
import { EXAMPLES, EXAMPLES_VERIFIED_AGAINST, EXAMPLES_VERIFIED_ON } from './pages/examples.js';
import { BIN_TARGET, CATEGORY_LABELS, PORTS, PORTS_CATALOG, publishedLibraryTargets, publishedTarget, TARGET_LABELS } from './ports/catalog.js';
import { portHref } from './ports/pages.js';
import { RELEASE } from './release.js';
import { LIMITS, WHY_POINTS } from './why.js';

// /llms.txt, generated at build time from the same snapshot and catalog the pages use, so what
// an agent reads here is what a visitor sees. Plain Markdown-flavoured text, no inline HTML.
const plain = (text) => text.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const absolute = (href) => `${SITE}${href}`;

export function renderLlmsText() {
    const lines = [
        '# crossbind',
        '',
        '> crossbind compiles C++ and Rust into WebAssembly, native iOS and Android libraries and WASI commands, then exposes them to JavaScript through bindings generated from the header you already own. One import runs in the browser, Node.js, Cloudflare Workers, React Native and as a WASI command.',
        '',
        `Current release: crossbind ${RELEASE.version} (${RELEASE.channel}, npm dist-tag \`${RELEASE.distTag}\`), published ${RELEASE.publishedAt.slice(0, 10)} from commit ${RELEASE.gitCommit}. Install commands carry \`${RELEASE.distTagSuffix || '(no suffix)'}\`.`,
        '',
        '## Why',
        '',
        ...WHY_POINTS.map(([title, text]) => `- ${title}: ${plain(text)}`),
        '',
        '## Limits',
        '',
        ...LIMITS.map((text) => `- ${plain(text)}`),
        '',
        '## Docs',
        '',
        ...GUIDE_PAGES.map((page) => `- [${page.title}](${absolute(page.href)}): ${page.description}`),
        `- [API reference](${absolute(API_URL)}): the runtime and build-time surfaces, the CLI and the canonical reference documents.`,
        `- [Libraries](${absolute(LIBRARIES_URL)}): prebuilt C++ libraries and WASI command tools.`,
        `- [Agent setup](${absolute(AGENT_URL)}): install the crossbind skill into a coding agent.`,
        `- [Changelog](${absolute(CHANGELOG_PAGE.href)}): every release on one page; the current release is at ${absolute(changelogHref(RELEASE.version))}`,
        '',
        '## Platforms',
        '',
        '- Browser: WebAssembly with a JavaScript loader; OPFS persistence needs a worker.',
        '- Node.js: WebAssembly with host filesystem access.',
        '- Cloudflare Workers and similar edge runtimes: WebAssembly, single-threaded, in-memory filesystem.',
        '- iOS and Android through React Native: native machine code over JSI, no Wasm.',
        '- WASI (wasm32-wasip3): one .wasm command run with wasmtime, no JavaScript host.',
        '',
        `## Libraries (npm \`${PORTS_CATALOG.distTag}\`)`,
        '',
        ...PORTS.map((port) => {
            const targets = publishedLibraryTargets(port).map((target) => TARGET_LABELS[target.target]);
            const bin = publishedTarget(port, BIN_TARGET);
            const parts = [
                `${port.name} ${port.nativeVersion} (${CATEGORY_LABELS[port.category] ?? port.category}, ${port.license})`,
                port.summary,
                `${port.npm}${targets.length ? `: ${targets.join(', ')}` : ': not published'}`,
                bin ? `${port.binCommands.length} WASI commands via ${bin.package}` : null,
            ].filter(Boolean);
            return `- [${parts.join(' - ')}](${absolute(portHref(port.family))})`;
        }),
        '',
        '## Examples',
        '',
        `Run from the published packages on ${EXAMPLES_VERIFIED_ON} against crossbind ${EXAMPLES_VERIFIED_AGAINST}: [${absolute(EXAMPLES_URL)}](${absolute(EXAMPLES_URL)})`,
        '',
        ...EXAMPLES.flatMap((entry) =>
            (entry.variants ?? [entry]).map((shown) => {
                const demo = DEMOS.get(shown.id);
                const label = entry.variants ? `${entry.title} · ${shown.label}` : entry.title;
                return `- ${label}: \`${shown.create}\`${demo ? `, running at ${absolute(demo.href)}` : ''}`;
            }),
        ),
        '',
        '## Source',
        '',
        `- [GitHub](${REPO_URL}), [Discussions](${DISCUSSIONS_URL}), [MIT licence](${LICENSE_URL})`,
        `- Sitemap: ${absolute('/sitemap.xml')}`,
        '',
    ];
    return `${lines.join('\n')}`;
}

import { REPO_URL, SITE } from '../data.js';
import {
    BIN_TARGET, CATEGORY_LABELS, PORTS, publishedLibraryTargets, publishedTarget, TARGET_LABELS,
} from '../ports/catalog.js';
import { portHref } from '../ports/pages.js';
import { SITE_PAGES } from '../site-pages.js';
import { createLinkResolver } from './links.js';
import { renderBlocks } from './markdown.js';
import { OVERVIEW_PAGE } from './overview.js';

export const resolveLink = createLinkResolver({
    site: SITE,
    repoUrl: REPO_URL,
    pagePaths: SITE_PAGES.map((page) => page.path),
});

export const twinPath = (path) => `${path === '/' ? '/index' : path}.md`;
export const twinUrl = (path) => `${SITE}${twinPath(path)}`;

const render = (blocks) => renderBlocks(blocks, resolveLink);

const npmCell = (port) => (port.published ? `\`${port.npm}@${port.published}\`` : `\`${port.npm}\` (not published)`);
const targetsCell = (port) => {
    const targets = publishedLibraryTargets(port).map((target) => TARGET_LABELS[target.target]);
    return targets.length ? targets.join(', ') : 'none published';
};
const commandsCell = (port) => {
    const bin = publishedTarget(port, BIN_TARGET);
    return bin ? `${port.binCommands.length} via \`${bin.package}\`` : 'none';
};

// The port page's "at a glance" rail and its outbound links, which the block list does not carry.
function portFacts(page) {
    const { port } = page;
    return render([
        {
            type: 'ul',
            items: [
                `Upstream: ${port.name} ${port.nativeVersion} (${CATEGORY_LABELS[port.category] ?? port.category})`,
                `npm: ${npmCell(port)}`,
                `Licence: \`${port.license}\``,
                `Targets: ${targetsCell(port)}`,
                `WASI commands: ${commandsCell(port)}`,
                ...(page.install ? [`Install: \`${page.install}\``] : []),
            ],
        },
        { type: 'p', text: page.links.map((link) => `[${link.label}](${link.href})`).join(' · ') },
    ]);
}

// The catalog itself; the HTML index renders it from the same data with its own layout.
function portsTable() {
    return render([{
        type: 'table',
        head: ['Library', 'Version', 'Category', 'Licence', 'npm', 'Published targets', 'WASI commands'],
        rows: PORTS.map((port) => [
            `[${port.name}](${portHref(port.family)})`,
            port.nativeVersion,
            CATEGORY_LABELS[port.category] ?? port.category,
            `\`${port.license}\``,
            npmCell(port),
            targetsCell(port),
            commandsCell(port),
        ]),
    }]);
}

export function pageDocument(page) {
    const parts = [
        `# ${page.title}`,
        `> ${page.description}`,
        `Page: ${SITE}${page.href}`,
        page.lede ? render([{ type: 'p', text: page.lede }]) : '',
        page.kind === 'port' ? portFacts(page) : '',
        render(page.blocks),
        page.kind === 'ports-index' ? portsTable() : '',
    ];
    return {
        title: page.title,
        description: page.description,
        path: twinPath(page.path),
        url: twinUrl(page.path),
        markdown: `${parts.filter(Boolean).join('\n\n')}\n`,
    };
}

export const overviewDocument = () => pageDocument(OVERVIEW_PAGE);

export const siteDocuments = () => SITE_PAGES.map(pageDocument);

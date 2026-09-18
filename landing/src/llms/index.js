import { CHANGELOG_PAGE } from '../changelog/page.js';
import { changelogHref } from '../changelog/route.js';
import {
    BRAND, DISCUSSIONS_URL, LICENSE_URL, REPO_URL, SITE, SKILL_COMMAND, V1_DOCS_URL,
} from '../data.js';
import { DEMOS } from '../demos.js';
import { GUIDE_HOME, GUIDE_SECTIONS } from '../guide/nav.js';
import AGENT_PAGE from '../pages/agent.js';
import API_PAGE, { REFERENCE_DOCUMENTS } from '../pages/api.js';
import EXAMPLES_PAGE, { EXAMPLES } from '../pages/examples.js';
import { PORT_PAGES, PORTS_INDEX } from '../ports/pages.js';
import { RELEASE } from '../release.js';
import { API_DOCS_BASE, readApiDocs } from './apiDocs.js';
import { overviewDocument, siteDocuments, twinPath, twinUrl } from './documents.js';
import { shiftHeadings } from './markdown.js';
import { ESSENTIALS, releaseLine, SUMMARY } from './overview.js';

const API_DOC_TITLES = {
    'init.md': 'Runtime initialization',
    'crossbind-config.md': 'Application configuration',
    'crossbind-build.md': 'Package build hooks',
    'build-state.md': 'Build state and targets',
    'filesystem.md': 'Filesystem',
    'threading.md': 'Threading',
    'cpp-binding-rules.md': 'C++ binding rules',
    'rust.md': 'Rust bindings',
    'wasi.md': 'WASI commands',
    'swig-escape.md': 'Custom SWIG interfaces',
    'overrides.md': 'Build overrides',
    'performance.md': 'Performance',
    'troubleshooting.md': 'Troubleshooting',
    'lifecycle-and-types.md': 'Lifecycle and TypeScript',
};

const SKILL_URL = `${REPO_URL}/blob/main/agents/skills/crossbind/SKILL.md`;
const FULL_URL = `${SITE}/llms-full.txt`;

const entry = (page) => `- [${page.title}](${twinUrl(page.path)}): ${page.description}`;
const apiDocUrl = (file) => `${SITE}${API_DOCS_BASE}/${file}`;

const exampleEntries = () => EXAMPLES.flatMap((example) => (example.variants ?? [example]).map((shown) => {
    const label = example.variants ? `${example.title} · ${shown.label}` : example.title;
    const demo = DEMOS.get(shown.id);
    return `- [${label}](${shown.source}): \`${shown.create}\`${demo ? `; live at ${SITE}${demo.href}` : ''}`;
}));

// /llms.txt: the index. A title, a one-line summary, the facts an agent needs before it reads
// anything else, then one link per page with the page's own description.
export function renderLlmsIndex() {
    return [
        `# ${BRAND}`,
        '',
        `> ${SUMMARY}`,
        '',
        releaseLine(),
        '',
        `Every page below is also served as Markdown at its own path plus \`.md\`, and [llms-full.txt](${FULL_URL}) `
            + `is all of them in one file. The home page is [index.md](${twinUrl('/')}).`,
        '',
        ...ESSENTIALS.map((item) => `- ${item}`),
        '',
        '## Guide',
        '',
        entry(GUIDE_HOME),
        ...GUIDE_SECTIONS.flatMap((section) => ['', `### ${section.label}`, '', ...section.pages.map(entry)]),
        '',
        '## API reference',
        '',
        entry(API_PAGE),
        ...REFERENCE_DOCUMENTS.map(([file, summary]) => `- [${file}](${apiDocUrl(file)}): ${summary}`),
        '',
        '## Libraries',
        '',
        entry(PORTS_INDEX),
        ...PORT_PAGES.map(entry),
        '',
        '## Examples',
        '',
        entry(EXAMPLES_PAGE),
        ...exampleEntries(),
        '',
        '## Agents',
        '',
        entry(AGENT_PAGE),
        `- [SKILL.md](${SKILL_URL}): the skill's entry point: routing, product-fit and safety rules.`,
        `- Install the skill: \`${SKILL_COMMAND}\``,
        '',
        '## Changelog',
        '',
        entry(CHANGELOG_PAGE),
        `- [Release notes for ${RELEASE.version}](${SITE}${changelogHref(RELEASE.version)})`,
        '',
        '## Optional',
        '',
        `- [llms-full.txt](${FULL_URL}): every page in this index as one Markdown file`,
        `- [Sitemap](${SITE}/sitemap.xml)`,
        `- [GitHub](${REPO_URL}): source, issues and releases`,
        `- [Discussions](${DISCUSSIONS_URL})`,
        `- [MIT licence](${LICENSE_URL})`,
        `- [cpp.js 1.x documentation](${V1_DOCS_URL}): the frozen documentation of the previous major`,
        '',
    ].join('\n');
}

// One document: a page becomes a prefixed H2 section with its own headings moved down a level.
const section = (doc, title) => ({ title, url: doc.url, markdown: shiftHeadings(doc.markdown.trimEnd(), title) });

// A reference document opens with its own H1; its canonical URL goes right under it.
function withPageLine({ url, markdown }) {
    const [heading, ...rest] = markdown.split('\n');
    return { url, markdown: `${heading}\n\nPage: ${url}\n${rest.join('\n')}` };
}

// /llms-full.txt: every document in reading order, separated by rules, with a table of contents.
export function renderLlmsFull() {
    const docs = new Map(siteDocuments().map((doc) => [doc.path, doc]));
    const apiDocs = new Map(readApiDocs().map((doc) => [doc.file, doc]));
    const page = (item, title) => section(docs.get(twinPath(item.path)), title);

    const sections = [
        section(overviewDocument(), 'Project overview'),
        ...GUIDE_SECTIONS.flatMap((group) => group.pages).map((item) => page(item, `Guide: ${item.title}`)),
        page(API_PAGE, 'API overview'),
        ...REFERENCE_DOCUMENTS.flatMap(([file]) => (apiDocs.has(file)
            ? [section(withPageLine(apiDocs.get(file)), `API: ${API_DOC_TITLES[file] ?? file}`)]
            : [])),
        page(PORTS_INDEX, 'Library catalog'),
        ...PORT_PAGES.map((item) => page(item, `Library: ${item.title}`)),
        page(EXAMPLES_PAGE, 'Examples'),
        page(AGENT_PAGE, 'Coding agents'),
        page(CHANGELOG_PAGE, 'Release history'),
    ];

    const header = [
        `# ${BRAND}: complete documentation`,
        '',
        `> ${SUMMARY}`,
        '',
        releaseLine(),
        '',
        `This file combines the ${sections.length} pages of ${SITE} in reading order: the overview, the guide, the API reference `
            + 'and its documents, the library catalog, the verified examples, agent setup and the release history. Each section '
            + 'starts with a `Page:` line naming its canonical URL, where the same content is served as Markdown. Use '
            + `[llms.txt](${SITE}/llms.txt) to pick a page first; load this file when a task needs the whole picture.`,
        '',
        'Example verification statements apply to the package versions and dates the project recorded; they do not imply that '
            + 'every later install from a moving npm tag has been retested.',
        '',
        '## Essential distinctions',
        '',
        ...ESSENTIALS.map((item) => `- ${item}`),
        '',
        '## Contents',
        '',
        ...sections.map((doc) => `- [${doc.title}](${doc.url})`),
    ].join('\n');

    return `${[header, ...sections.map((doc) => doc.markdown)].join('\n\n---\n\n')}\n`;
}

// Every Markdown file the build writes next to the HTML pages, as dist-relative paths.
export function markdownPages() {
    return [
        overviewDocument(),
        ...siteDocuments(),
        ...readApiDocs(),
    ].map(({ path, markdown }) => ({ path, markdown }));
}

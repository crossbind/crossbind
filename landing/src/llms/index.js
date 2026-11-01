import { CHANGELOG_PAGE } from '../changelog/page.js';
import { changelogHref } from '../changelog/route.js';
import {
    AGENT_PROMPT, AGENT_PROMPT_PATH, BRAND, DISCUSSIONS_URL, REPO_URL, SITE, SKILL_COMMAND, V1_DOCS_URL,
} from '../data.js';
import { DEMOS } from '../demos.js';
import { GUIDE_SECTIONS } from '../guide/nav.js';
import AGENT_PAGE from '../pages/agent.js';
import EXAMPLES_PAGE, { TEMPLATE_GROUPS } from '../pages/examples.js';
import INTEGRATIONS_PAGE from '../pages/integrations.js';
import LICENSE_PAGE from '../pages/license.js';
import { TUTORIAL_PAGES } from '../pages/tutorial.js';
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
    'conan.md': 'Conan packages',
    'wasi.md': 'WASI commands and HTTP components',
    'native.md': 'Native platforms',
    'swig-escape.md': 'Custom SWIG interfaces',
    'overrides.md': 'Build overrides',
    'performance.md': 'Performance',
    'troubleshooting.md': 'Troubleshooting',
    'lifecycle-and-types.md': 'Lifecycle and TypeScript',
};

const REFERENCE_DOCUMENTS = [
    ['init.md', '`initNative(opts)` - the runtime entry point and the module helpers it returns.'],
    ['crossbind-config.md', '`crossbind.config.js` field by field: dependencies, paths, targets, runtime flags.'],
    ['crossbind-build.md', '`crossbind.build.js` lifecycle hooks for package authors.'],
    ['build-state.md', 'the `state` and `target` shapes hooks receive, and the inventory of built-in build targets.'],
    ['filesystem.md', 'OPFS, memfs, node-fs and edge filesystems, and the `useWorker` requirement.'],
    ['threading.md', "`runtime: 'st' | 'mt'`, `useWorker`, COOP/COEP and edge-runtime limits."],
    ['cpp-binding-rules.md', 'what the auto-binder accepts and the wrapper pattern for the rest.'],
    ['rust.md', '`cargo:` crate imports, app-local `.rs` sources, `export.type: \'cargo\'` packages and `crossbind.cargo.lock`.'],
    ['conan.md', '`conan:` imports of C and C++ packages from ConanCenter, `conanDependencies` and `conan.lock`.'],
    ['wasi.md', "`platform: 'wasi'` command builds, `-wasi` prebuilts and `-standalone-wasi` tool packages."],
    ['native.md', 'desktop platforms beyond Node.js addons: native executables and the prebuilt archives in your own C or C++ build.'],
    ['swig-escape.md', 'hand-written SWIG `.i` files when generation is not enough.'],
    ['overrides.md', 'every override mechanism, ordered from least to most invasive.'],
    ['performance.md', 'the default Emscripten and CMake flags, and what is safe to change.'],
    ['troubleshooting.md', 'common errors mapped to the right override.'],
    ['lifecycle-and-types.md', 'what the garbage collector frees and when to call `delete()`, and TypeScript notes.'],
];

const SKILL_URL = `${REPO_URL}/blob/main/agents/skills/crossbind/SKILL.md`;
const FULL_URL = `${SITE}/llms-full.txt`;

const entry = (page) => `- [${page.title}](${twinUrl(page.path)}): ${page.description}`;
const apiDocUrl = (file) => `${SITE}${API_DOCS_BASE}/${file}`;

const exampleEntries = () => TEMPLATE_GROUPS.flatMap((group) => group.templates.map((template) => {
    const demo = DEMOS.get(template.key);
    return `- [${template.title}](${template.source}): \`${template.command}\`${demo ? `; live at ${SITE}${demo.href}` : ''}`;
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
        ...GUIDE_SECTIONS.flatMap((section) => ['', `### ${section.label}`, '', ...section.pages.map(entry)]),
        '',
        '## Tutorial',
        '',
        ...TUTORIAL_PAGES.map(entry),
        '',
        '## API reference',
        '',
        ...REFERENCE_DOCUMENTS.map(([file, summary]) => `- [${file}](${apiDocUrl(file)}): ${summary}`),
        '',
        '## Libraries',
        '',
        entry(PORTS_INDEX),
        ...PORT_PAGES.map(entry),
        '',
        '## Integrations',
        '',
        entry(INTEGRATIONS_PAGE),
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
        `- [Setup instructions](${SITE}${AGENT_PROMPT_PATH}): install the skill, then add ${BRAND} to the project in the current directory and verify one call.`,
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
        `- [MIT license](${twinUrl(LICENSE_PAGE.path)})`,
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
        ...TUTORIAL_PAGES.map((item) => page(item, `Tutorial: ${item.title}`)),
        ...REFERENCE_DOCUMENTS.flatMap(([file]) => (apiDocs.has(file)
            ? [section(withPageLine(apiDocs.get(file)), `API: ${API_DOC_TITLES[file] ?? file}`)]
            : [])),
        page(PORTS_INDEX, 'Library catalog'),
        ...PORT_PAGES.map((item) => page(item, `Library: ${item.title}`)),
        page(INTEGRATIONS_PAGE, 'Integrations'),
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
            + 'documents, the library catalog, the integrations, the examples, agent setup and the release history. Each section '
            + 'starts with a `Page:` line naming its canonical URL, where the same content is served as Markdown. Use '
            + `[llms.txt](${SITE}/llms.txt) to pick a page first; load this file when a task needs the whole picture.`,
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
        // What the home page's one line sends an agent to.
        { path: AGENT_PROMPT_PATH, markdown: AGENT_PROMPT },
    ].map(({ path, markdown }) => ({ path, markdown }));
}

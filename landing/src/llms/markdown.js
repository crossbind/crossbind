import { CHANNEL_LABEL, formatPublishedAt } from '../changelog/format.js';

// The pages' inline syntax (`code`, **bold**, [label](href)) is already Markdown; only link targets
// are rewritten, through the resolver the caller passes in.
const LINK_TARGET = /\]\(([^)\s]+)\)/g;

const FENCE_LANGUAGES = [
    [/\.[mc]?js$/, 'js'],
    [/\.jsx$/, 'jsx'],
    [/\.tsx?$/, 'ts'],
    [/\.(?:h|hpp|cpp|cc)$/, 'cpp'],
    [/\.rs$/, 'rust'],
    [/\.json$/, 'json'],
    [/\.md$/, 'md'],
    [/\.toml$/, 'toml'],
    [/\.ya?ml$/, 'yaml'],
];

const MIN_FENCE = 3;

export function fenceLanguage(file = '') {
    if (file === 'shell') return 'sh';
    const match = FENCE_LANGUAGES.find(([pattern]) => pattern.test(file));
    return match ? match[1] : 'text';
}

const links = (text, resolveLink) => String(text).replace(LINK_TARGET, (_, href) => `](${resolveLink(href)})`);

const codeLabel = (file) => {
    if (!file || file === 'shell') return '';
    return file === 'prompt' ? 'Prompt:\n\n' : `\`${file}\`:\n\n`;
};

function fence(code, file) {
    const longestRun = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
    const ticks = '`'.repeat(Math.max(MIN_FENCE, longestRun + 1));
    return `${codeLabel(file)}${ticks}${fenceLanguage(file)}\n${code}\n${ticks}`;
}

const cell = (text, resolveLink) => links(text, resolveLink).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function table({ head, rows }, resolveLink) {
    const line = (cells) => `| ${cells.map((text) => cell(text, resolveLink)).join(' | ')} |`;
    return [line(head), `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

const list = (items, ordered, resolveLink) => items
    .map((item, i) => `${ordered ? `${i + 1}.` : '-'} ${links(item, resolveLink)}`)
    .join('\n');

function callout({ tone, title, text }, resolveLink) {
    const label = title || (tone === 'warn' ? 'Watch out' : 'Note');
    return `> **${label}:** ${links(text, resolveLink)}`;
}

const cards = (items, resolveLink) => items
    .map((card) => `- [${card.title}](${resolveLink(card.href)}): ${card.desc}`)
    .join('\n');

function release({ channel, prerelease, publishedAt, npmUrl, githubReleaseUrl }) {
    const label = `${CHANNEL_LABEL[channel] ?? channel}${prerelease ? ' · prerelease' : ''}`;
    return `${label} · published ${formatPublishedAt(publishedAt)} · [npm](${npmUrl}) · [GitHub Release](${githubReleaseUrl})`;
}

const RENDERERS = {
    h2: (block) => `## ${block.text}`,
    h3: (block) => `### ${block.text}`,
    p: (block, resolveLink) => links(block.text, resolveLink),
    ul: (block, resolveLink) => list(block.items, false, resolveLink),
    ol: (block, resolveLink) => list(block.items, true, resolveLink),
    code: (block) => fence(block.code, block.file),
    callout,
    table,
    cards: (block, resolveLink) => cards(block.items, resolveLink),
    release: (block) => release(block.release),
};

// llms-full.txt is one document: a page's H1 becomes a prefixed H2 and every heading under it
// moves down a level. Fenced code is left alone, so a `# comment` in a shell block survives.
export function shiftHeadings(markdown, title) {
    let fenced = false;
    let untitled = true;
    return markdown.split('\n').map((line) => {
        if (/^(?:`{3,}|~{3,})/.test(line)) fenced = !fenced;
        if (fenced || !/^#{1,5} /.test(line)) return line;
        if (untitled && line.startsWith('# ')) {
            untitled = false;
            return `## ${title}`;
        }
        return `#${line}`;
    }).join('\n');
}

export function renderBlocks(blocks, resolveLink = (href) => href) {
    return blocks
        .map((block) => RENDERERS[block.type]?.(block, resolveLink) ?? '')
        .filter(Boolean)
        .join('\n\n');
}

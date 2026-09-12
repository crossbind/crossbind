// Converts the human-authored release-note body into the landing site's block model
// (landing/src/guide/Article.jsx). The site deliberately ships no Markdown parser, so this covers
// what release notes actually use and maps each construct onto a block the site already renders:
// ##/### headings, paragraphs, - and 1. lists (with indented or lazy continuation lines), fenced
// code blocks, GFM pipe tables and > quotes (as a note callout). Inline `code`, **bold** and
// [label](href) pass through to the site's inline renderer. Images, HTML, other heading levels
// and reference-style links fail the build instead of degrading silently.

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const BULLET = /^-\s+(.+)$/;
const ORDERED = /^\d+\.\s+(.+)$/;
const FENCE = /^(`{3,}|~{3,})\s*([\w+.-]*)\s*$/;
const TABLE_ROW = /^\|.*\|$/;
const TABLE_DELIMITER = /^\|(?:\s*:?-+:?\s*\|)+$/;
const QUOTE = /^>\s?(.*)$/;
const THEMATIC_BREAK = /^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/;
const UNSUPPORTED_LINE = /^(?:[*+]\s|<|\t|\[[^\]]+\]:\s)/;
const UNSUPPORTED_INLINE = /!\[|<[A-Za-z/!]|\]\[/;

function slugify(text) {
    return text
        .toLowerCase()
        .replaceAll(/[`*_]/g, '')
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-|-$/g, '');
}

function splitTableRow(line) {
    return line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replaceAll('\\|', '|'));
}

export function releaseNotesBlocks(markdown, source = 'release notes') {
    const lines = String(markdown).replaceAll('\r\n', '\n').split('\n');
    const blocks = [];
    const ids = new Map();
    let paragraph = null;
    let list = null;
    let quote = null;
    let fence = null;
    let table = null;

    const fail = (index, reason) => {
        throw new Error(`${source}:${index + 1}: unsupported Markdown (${reason}).`);
    };
    const flush = () => {
        if (paragraph) blocks.push({ type: 'p', text: paragraph.join(' ') });
        if (list) blocks.push(list);
        if (quote) blocks.push({ type: 'callout', tone: 'note', title: 'Note', text: quote.join(' ') });
        if (table) blocks.push(table);
        paragraph = null;
        list = null;
        quote = null;
        table = null;
    };
    const uniqueId = (text) => {
        const base = slugify(text) || 'section';
        const count = (ids.get(base) ?? 0) + 1;
        ids.set(base, count);
        return count === 1 ? base : `${base}-${count}`;
    };

    for (const [index, raw] of lines.entries()) {
        const line = raw.trimEnd();

        if (fence) {
            if (line.startsWith(fence.marker) && !line.slice(fence.marker.length).trim()) {
                blocks.push({ type: 'code', file: fence.language, code: fence.lines.join('\n') });
                fence = null;
            } else {
                fence.lines.push(raw);
            }
            continue;
        }

        if (!line.trim()) {
            flush();
            continue;
        }

        const opening = FENCE.exec(line);
        if (opening) {
            flush();
            fence = { marker: opening[1], language: opening[2] || 'text', lines: [] };
            continue;
        }
        if (THEMATIC_BREAK.test(line)) {
            // A rule separates sections the headings already separate; nothing to render.
            flush();
            continue;
        }
        if (UNSUPPORTED_INLINE.test(line)) fail(index, 'images, HTML and reference-style links are not rendered');

        const heading = HEADING.exec(line);
        if (heading) {
            flush();
            const level = heading[1].length;
            if (level === 2) blocks.push({ type: 'h2', id: uniqueId(heading[2]), text: heading[2] });
            else if (level === 3) blocks.push({ type: 'h3', text: heading[2] });
            else fail(index, `level-${level} heading; use ## or ###`);
            continue;
        }

        if (TABLE_ROW.test(line)) {
            if (paragraph || list || quote) flush();
            const cells = splitTableRow(line);
            if (!table) {
                table = { type: 'table', head: cells, rows: [], delimited: false };
            } else if (!table.delimited) {
                if (!TABLE_DELIMITER.test(line)) fail(index, 'a table header must be followed by a |---| delimiter row');
                table.delimited = true;
            } else {
                if (cells.length !== table.head.length) fail(index, `table row has ${cells.length} cells, header has ${table.head.length}`);
                table.rows.push(cells);
            }
            continue;
        }
        if (table) fail(index, 'a table must end with a blank line');

        const quoted = QUOTE.exec(line);
        if (quoted) {
            if (paragraph || list) flush();
            quote ??= [];
            if (quoted[1].trim()) quote.push(quoted[1].trim());
            continue;
        }
        if (quote) fail(index, 'a quote must end with a blank line');

        const indented = /^\s+\S/.test(raw);
        if (indented && !list) fail(index, 'an indented line outside a list has no meaning here');
        if (!indented && UNSUPPORTED_LINE.test(line)) fail(index, 'HTML, * or + bullets and reference definitions are not rendered');

        const bullet = BULLET.exec(line);
        const ordered = ORDERED.exec(line);
        if (bullet || ordered) {
            const type = bullet ? 'ul' : 'ol';
            if (paragraph || (list && list.type !== type)) flush();
            list ??= { type, items: [] };
            list.items.push((bullet ?? ordered)[1].trim());
            continue;
        }

        if (list) {
            // Indented or lazy continuation lines extend the last item.
            list.items[list.items.length - 1] += ` ${line.trim()}`;
            continue;
        }
        paragraph ??= [];
        paragraph.push(line.trim());
    }
    if (fence) throw new Error(`${source}: a fenced code block is never closed.`);
    flush();

    const finished = blocks.map((block) => {
        if (block.type !== 'table') return block;
        if (!block.delimited) throw new Error(`${source}: a table header has no |---| delimiter row.`);
        return { type: 'table', head: block.head, rows: block.rows };
    });
    if (!finished.length) throw new Error(`${source}: the release-note body is empty.`);
    return finished;
}

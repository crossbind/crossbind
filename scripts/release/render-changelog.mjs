import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseNotes, RELEASE_NOTES_DIRECTORY } from './release-lib.mjs';

// CHANGELOG.md is rendered, not written: the region between the two markers is generated from the
// release notes in releases/crossbind/, newest first, with each note's headings demoted one level
// under its version. Everything outside the region is kept as it is - that is where the entries
// from before the release-note files live. `--check` fails when the region is out of date, so the
// note stays the only place a release is described.

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHANGELOG_FILE = path.join(REPOSITORY_ROOT, 'CHANGELOG.md');
export const NOTES_DIRECTORY = path.join(REPOSITORY_ROOT, RELEASE_NOTES_DIRECTORY);
export const REGION_START = '<!-- release-notes:start -->';
export const REGION_END = '<!-- release-notes:end -->';

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;
const HEADING = /^## (\S+)\s*$/;
// Only version-named files are notes; TEMPLATE.md and anything else in the directory are not.
const NOTE_FILE = /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?\.md$/;

function parseVersion(version) {
    const match = VERSION.exec(version);
    if (!match) throw new Error(`"${version}" is not a version this changelog can order (MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-tag.N).`);
    return { core: match.slice(1, 4).map(Number), tag: match[4] ?? null, pre: match[5] === undefined ? null : Number(match[5]) };
}

// Newest first. A stable version outranks its own prereleases; prereleases order by tag then number.
export function compareVersionsDesc(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
        if (left.core[i] !== right.core[i]) return right.core[i] - left.core[i];
    }
    if (left.pre === null || right.pre === null) return (left.pre === null ? 0 : 1) - (right.pre === null ? 0 : 1);
    if (left.tag !== right.tag) return left.tag < right.tag ? 1 : -1;
    return right.pre - left.pre;
}

export function loadNotes(directory = NOTES_DIRECTORY) {
    const files = fs
        .readdirSync(directory)
        .filter((name) => NOTE_FILE.test(name))
        .sort();
    const notes = files.map((name) => {
        const source = `${RELEASE_NOTES_DIRECTORY}/${name}`;
        const { metadata, body } = parseReleaseNotes(fs.readFileSync(path.join(directory, name), 'utf8'), source);
        if (`${metadata.version}.md` !== name) throw new Error(`${source}: frontmatter version "${metadata.version}" does not match the file name.`);
        return { version: metadata.version, title: metadata.title, summary: metadata.summary, body, source };
    });
    return notes.sort((a, b) => compareVersionsDesc(a.version, b.version));
}

export function renderSection(note) {
    const body = note.body
        .split('\n')
        .map((line) => (line.startsWith('## ') ? `#${line}` : line))
        .join('\n');
    return `## ${note.version}\n\n${note.summary}\n\n${body}\n`;
}

export function renderRegion(notes) {
    return [
        REGION_START,
        `<!-- Generated from ${RELEASE_NOTES_DIRECTORY}/<version>.md by scripts/release/render-changelog.mjs. Edit the note, then run \`pnpm changelog\`. -->`,
        '',
        ...notes.map(renderSection),
        REGION_END,
    ].join('\n');
}

export function renderChangelog(existing, notes) {
    const start = existing.indexOf(REGION_START);
    const end = existing.indexOf(REGION_END);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`CHANGELOG.md needs the ${REGION_START} and ${REGION_END} markers, in that order.`);
    }
    return `${existing.slice(0, start)}${renderRegion(notes)}${existing.slice(end + REGION_END.length)}`;
}

// Every `## <version>` section of the file, in file order, with the Markdown under it; the markers
// and the generator comment are dropped so what comes back is plain Markdown.
export function splitChangelog(markdown) {
    const sections = [];
    let current = null;
    for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) continue;
        const heading = HEADING.exec(line);
        if (heading && VERSION.test(heading[1])) {
            current = { version: heading[1], lines: [] };
            sections.push(current);
            continue;
        }
        if (current) current.lines.push(line);
    }
    return sections.map((section) => ({ version: section.version, body: section.lines.join('\n').trim() }));
}

export function assertChangelogCurrent({ file = CHANGELOG_FILE, directory = NOTES_DIRECTORY } = {}) {
    const existing = fs.readFileSync(file, 'utf8');
    if (renderChangelog(existing, loadNotes(directory)) !== existing) {
        throw new Error(`${path.relative(REPOSITORY_ROOT, file)} is out of date with ${RELEASE_NOTES_DIRECTORY}/; run \`pnpm changelog\`.`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.includes('--check')) {
            assertChangelogCurrent();
            process.stdout.write('CHANGELOG.md matches the release notes.\n');
        } else {
            const notes = loadNotes();
            fs.writeFileSync(CHANGELOG_FILE, renderChangelog(fs.readFileSync(CHANGELOG_FILE, 'utf8'), notes));
            process.stdout.write(`CHANGELOG.md: ${notes.length} release notes rendered (${notes.map((note) => note.version).join(', ')}).\n`);
        }
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

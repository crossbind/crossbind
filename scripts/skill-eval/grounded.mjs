// Whether an answer keeps to what exists: the `crossbind` commands, the `@crossbind/*` packages, the names a page
// imports from `crossbind/app` and `crossbind/licenses`, and the create-crossbind templates. The vocabulary comes from
// the documents an installed skill carries, the command line's own source and the workspace's packages.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The commands that take a command of their own as their next word.
const PARENT_COMMANDS = new Set(['app', 'config', 'docker', 'runner']);
const IMPORT_MODULES = ['crossbind/app', 'crossbind/licenses'];

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const SPAN = /`([^`\n]+)`/g;
// `crossbind` where a shell would take it as the command, then its first one or two words.
const COMMAND = /(?:^\s*(?:\$ )?|&&\s*|;\s*|\bnpx |\bpnpm (?:exec |dlx )?|\byarn |\bbunx |\bnpm exec (?:-- )?)crossbind((?: +[a-z][a-z-]*){1,2})/g;
const PACKAGE = /@crossbind\/([a-z0-9][a-z0-9-]*)/g;
const NAMED_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](crossbind\/(?:app|licenses))['"]/g;
const TEMPLATE = /npm create crossbind(?:@[\w.-]+)?\s+--\s+(?:<[^>]*>|[^\s<]\S*)\s+([^\n#&|;)]+)/g;
const SOURCE_COMMAND = /\b(program|command[A-Z][A-Za-z]*)\.command\('([a-z][a-z-]*)'/g;

// Each line of a fenced block and each inline span: where an answer writes what is to be typed.
export function codeSegments(markdown) {
    const fenced = [...markdown.matchAll(FENCE)].flatMap((match) => match[1].split('\n'));
    const inline = [...markdown.replaceAll(FENCE, '').matchAll(SPAN)].map((match) => match[1]);
    return [...fenced, ...inline];
}

function commandsOf(markdown) {
    return codeSegments(markdown).flatMap((segment) => (
        [...segment.matchAll(COMMAND)].map((match) => match[1].trim().split(/ +/))
    ));
}

function importsOf(markdown) {
    return [...markdown.matchAll(NAMED_IMPORT)].flatMap(([, names, module]) => (
        names.split(',').map((name) => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean).map((name) => ({ name, module }))
    ));
}

function templatesOf(markdown) {
    return codeSegments(markdown).flatMap((segment) => (
        [...segment.matchAll(TEMPLATE)].map((match) => match[1].replaceAll('"', '').trim())
    ));
}

export function bundledDocuments(root) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'agents', 'skills', 'crossbind', 'references', 'manifest.json'), 'utf8'));
    // The port catalog's source is a pattern of files, not a document.
    const documents = manifest.references.map((reference) => reference.source).filter((source) => source.endsWith('.md'));
    return [...documents, 'agents/skills/crossbind/SKILL.md'];
}

function packageNames(root) {
    const listed = spawnSync('git', ['ls-files', '*package.json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.stderr}`);
    const names = listed.stdout.split('\n').filter(Boolean).map((file) => {
        try {
            return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).name;
        } catch {
            // A template's package.json may be a fragment that is no JSON by itself.
            return null;
        }
    });
    return new Set(names.filter(Boolean));
}

export function buildVocabulary(root) {
    const commands = new Set();
    const subcommands = new Set();
    const take = ([first, second]) => {
        commands.add(first);
        if (second && PARENT_COMMANDS.has(first)) subcommands.add(`${first} ${second}`);
    };
    const imports = new Map(IMPORT_MODULES.map((module) => [module, new Set()]));

    for (const file of bundledDocuments(root)) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        commandsOf(text).forEach(take);
        for (const { name, module } of importsOf(text)) imports.get(module).add(name);
    }
    for (const file of ['bin.js', 'program.js']) {
        const source = fs.readFileSync(path.join(root, 'core', 'crossbind', 'src', file), 'utf8');
        for (const [, owner, name] of source.matchAll(SOURCE_COMMAND)) {
            const parent = owner.slice('command'.length).toLowerCase();
            // A third word, as `upload` in `app key upload`, goes unchecked.
            if (owner === 'program') take([name]);
            else if (PARENT_COMMANDS.has(parent)) take([parent, name]);
        }
    }

    const templates = new Set();
    for (const entry of JSON.parse(fs.readFileSync(path.join(root, 'tooling', 'create-app', 'src', 'manifest.json'), 'utf8'))) {
        const words = [entry.group, entry.framework ?? entry.label, ...(entry.framework ? [entry.label] : [])];
        // The scaffolder asks for what is left out, so each leading part of a template's words names a start.
        words.forEach((unused, index) => templates.add(words.slice(0, index + 1).join(' ').toLowerCase()));
    }

    return { commands, subcommands, packages: packageNames(root), imports, templates };
}

// What the answer names that the vocabulary has not, each once: [{ kind, text }]; an empty list for a grounded answer.
export function ungrounded(answer, vocabulary) {
    const slips = new Map();
    const note = (kind, text) => slips.set(`${kind}: ${text}`, { kind, text });

    for (const [first, second] of commandsOf(answer)) {
        if (!vocabulary.commands.has(first)) note('command', `crossbind ${first}`);
        else if (second && PARENT_COMMANDS.has(first) && !vocabulary.subcommands.has(`${first} ${second}`)) note('command', `crossbind ${first} ${second}`);
    }
    for (const match of answer.matchAll(PACKAGE)) {
        const name = match[1];
        // `@crossbind/port-<name>` and `@crossbind/port-gdal-<platform>` stand for a family, not for one package.
        const isPlaceholder = name.endsWith('-') || '<*{$'.includes(answer[match.index + match[0].length] ?? ' ');
        if (!isPlaceholder && !vocabulary.packages.has(`@crossbind/${name}`)) note('package', `@crossbind/${name}`);
    }
    for (const { name, module } of importsOf(answer)) {
        if (!vocabulary.imports.get(module).has(name)) note('import', `${name} from ${module}`);
    }
    for (const template of templatesOf(answer)) {
        if (!template.includes('<') && !vocabulary.templates.has(template.toLowerCase())) note('template', template);
    }
    return [...slips.values()];
}

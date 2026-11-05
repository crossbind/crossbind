import fsp from 'node:fs/promises';
import path from 'node:path';
import { renameInReadme } from './readme.js';

// The extension the app-extension template carries, which a scaffold names after its project: every word starter in
// the template's text files is its name, so the template uses the word for nothing else.
const TEMPLATE_NAME = 'starter';
// An extension's name, as crossbind takes it: lowercase letters and digits, dashes between, from a letter.
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const TEXT_FILE = /\.(js|ts|md|cpp|h|mm|java)$/;
const TEMPLATE_WORD = new RegExp(`crossbind_extension_${TEMPLATE_NAME}\\b|\\b${TEMPLATE_NAME}\\b`, 'g');
// The words module code keeps, which can name neither the template's default export nor its import in the README.
const RESERVED = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval '
    + 'export extends false finally for function if implements import in instanceof interface let new null package private '
    + 'protected public return static super switch this throw true try typeof var void while with yield').split(' '));

// The extension name of a project's folder, or null when it makes none: the folder's own name in lowercase, with a dash
// for each run of other characters and without a crossbind-extension- of its own.
export function extensionName(folder) {
    const name = path.basename(path.resolve(folder)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .replace(/^crossbind-extension(-|$)/, '');
    return NAME.test(name) ? name : null;
}

// The JavaScript name of an extension: camelCase, with Extension after a word module code keeps.
function identifierOf(name) {
    const camel = name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
    return RESERVED.has(camel) ? `${camel}Extension` : camel;
}

// A template's text with its extension named: the C++ entry with underscores for dashes, the name itself before a dot
// or in quotes, and its JavaScript name elsewhere. One pass, so a name that holds the template's stays whole.
export function renamedText(text, name) {
    const identifier = identifierOf(name);
    return text.replace(TEMPLATE_WORD, (word, at) => {
        if (word !== TEMPLATE_NAME) return `crossbind_extension_${name.replaceAll('-', '_')}`;
        const before = text[at - 1];
        const after = text[at + word.length];
        return after === '.' || ((before === "'" || before === '"') && after === before) ? name : identifier;
    });
}

// The text files the template gave the project, and those named after the template's extension; a file of the folder's
// own is left as it is.
async function renameFiles(template, dir, name) {
    for (const entry of await fsp.readdir(template, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
        const file = path.join(dir, path.relative(template, entry.parentPath), entry.name);
        await fsp.writeFile(file, renamedText(await fsp.readFile(file, 'utf8'), name));
        if (entry.name.startsWith(`${TEMPLATE_NAME}.`)) {
            await fsp.rename(file, path.join(path.dirname(file), `${name}${entry.name.slice(TEMPLATE_NAME.length)}`));
        }
    }
}

// Names a scaffolded extension after its project: its files, then its package, whose name the README takes last so a
// name that holds the template's word stays whole.
export async function nameExtension(template, dir, name) {
    await renameFiles(template, dir, name);
    const pjPath = path.join(dir, 'package.json');
    // private keeps the template's sample out of the repository's releases; an extension is a package to publish.
    const { name: templateName, private: _, ...fields } = JSON.parse(await fsp.readFile(pjPath, 'utf8'));
    const pkg = { name: `crossbind-extension-${name}`, ...fields };
    await fsp.writeFile(pjPath, `${JSON.stringify(pkg, null, 2)}\n`);
    const readmePath = path.join(dir, 'README.md');
    await fsp.writeFile(readmePath, renameInReadme(await fsp.readFile(readmePath, 'utf8'), templateName, pkg.name));
}

import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rollup/parseAst';

// The kinds of crossbind.config whose default export can be an object literal to write into.
const CONFIG_EXTENSIONS = ['js', 'mjs', 'cjs'];
const DEFAULT_INDENT = '    ';

const indentOf = (source, at) => source.slice(source.lastIndexOf('\n', at - 1) + 1).match(/^[ \t]*/)[0];
const isOneLine = (source, from, to) => !source.slice(from, to).includes('\n');
const insert = (source, at, text) => `${source.slice(0, at)}${text}${source.slice(at)}`;
const propertyOf = (object, name) => object.properties.find((property) => property.type === 'Property' && !property.computed
    && (property.key.name ?? property.key.value) === name);
// A spread may carry the key, and would win over one written before it.
const hasSpread = (object) => object.properties.some((property) => property.type === 'SpreadElement');
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ESCAPES = {
    '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t', '\u2028': '\\u2028', '\u2029': '\\u2029',
};
// A string in single quotes, with what would end its line or its text escaped.
// eslint-disable-next-line no-control-regex
const quoted = (text) => `'${text.replace(/[\\'\u0000-\u001f\u2028\u2029]/g, (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`;
// A key as one writes it: a name as it is, anything else quoted.
const keyOf = (key) => (IDENTIFIER.test(key) ? key : quoted(key));
// A value as one writes it in a config by hand: { fileTimestamp: ['C617.1'] }.
function literal(value) {
    if (typeof value === 'string') return quoted(value);
    if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
    if (value !== null && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${keyOf(key)}: ${literal(item)}`).join(', ')} }`;
    return JSON.stringify(value);
}
export const entry = (key, value) => `${keyOf(key)}: ${literal(value)}`;

// How far an object's keys sit in from the line it opens on.
function indentUnit(source, object) {
    const [first] = object.properties;
    if (!first || isOneLine(source, object.start, first.start)) return DEFAULT_INDENT;
    return indentOf(source, first.start).slice(indentOf(source, object.start).length) || DEFAULT_INDENT;
}

// `key: value` where the rest of a key's path makes the objects the value goes in: window: { width: 800 }.
const nestedEntry = ([key, ...rest], value) => entry(key, rest.reduceRight((inner, name) => ({ [name]: inner }), value));

// The source with the entry of `keys` first in `object`, or in the object it holds under the first key, which it makes
// where there is none, or null where it cannot place it safely: a spread in an object a key goes in may carry the key.
function withEntry(source, { object, property }, keys, value, unit) {
    const [key, ...rest] = keys;
    const found = propertyOf(object, key);
    if (found) {
        if (rest.length === 0 || found.value.type !== 'ObjectExpression') return null;
        return withEntry(source, { object: found.value, property: found }, rest, value, unit);
    }
    if (hasSpread(object)) return null;
    const [first] = object.properties;
    if (!first && property) {
        const indent = indentOf(source, property.start);
        return `${source.slice(0, object.start)}{\n${indent}${unit}${nestedEntry(keys, value)},\n${indent}}${source.slice(object.end)}`;
    }
    if (!first || isOneLine(source, object.start, first.start)) return insert(source, object.start + 1, ` ${nestedEntry(keys, value)},`);
    const indent = indentOf(source, first.start);
    if (rest.length === 0) return insert(source, object.start + 1, `\n${indent}${entry(key, value)},`);
    // A section the object lacks opens on lines of its own, as the object writes its keys.
    return insert(source, object.start + 1, `\n${indent}${key}: {\n${indent}${unit}${nestedEntry(rest, value)},\n${indent}},`);
}

// The config's source with the option a key's path names, as ['app', 'id'], first in the object it goes in, or null
// where it cannot place it safely: the default export and each object on the way must be object literals, the last
// without the key.
export function withOption(source, keys, value) {
    const exported = parseAst(source).body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration;
    if (exported?.type !== 'ObjectExpression') return null;
    return withEntry(source, { object: exported, property: null }, keys, value, indentUnit(source, exported));
}

// Every name the module's code holds, bound or read, which a name it gains must not take.
function namesIn(node, names = new Set()) {
    if (Array.isArray(node)) node.forEach((child) => namesIn(child, names));
    if (typeof node?.type !== 'string') return names;
    if (node.type === 'Identifier') names.add(node.name);
    Object.values(node).filter((child) => child && typeof child === 'object').forEach((child) => namesIn(child, names));
    return names;
}

const isCallOf = (identifier) => (element) => element?.type === 'CallExpression' && element.callee.type === 'Identifier'
    && element.callee.name === identifier;
// A hashbang and the line comments that open a module, as // @ts-check, stay first in it.
const TOP_LINES = /^(?:#![^\n]*\n)?(?:\/\/[^\n]*\n)*/;

// The name, or with Extension after it and a number after that, the first the module does not hold.
function freeName(name, taken) {
    for (let count = 0; ; count += 1) {
        const candidate = count === 0 ? name : `${name}Extension${count === 1 ? '' : count}`;
        if (!taken.has(candidate)) return candidate;
    }
}

// Where a call goes first in an extensions list, as the list writes its entries: on a line of its own where they are.
// Where there is no list, a list of it goes first in the object.
function listEdit(source, eol, object, list, call) {
    if (!list) {
        const [first] = object.properties;
        if (!first || isOneLine(source, object.start, first.start)) return { at: object.start + 1, text: ` extensions: [${call}],` };
        return { at: object.start + 1, text: `${eol}${indentOf(source, first.start)}extensions: [${call}],` };
    }
    const [first] = list.elements;
    if (!first) return { at: list.start + 1, text: call };
    if (isOneLine(source, list.start, first.start)) return { at: list.start + 1, text: `${call}, ` };
    return { at: list.start + 1, text: `${eol}${indentOf(source, first.start)}${call},` };
}

// Where the import of an extension goes: after the module's last import, else after the lines that open it.
function importEdit(source, eol, program, identifier, specifier) {
    const line = `import ${identifier} from ${literal(specifier)};`;
    const last = program.body.filter((node) => node.type === 'ImportDeclaration').at(-1);
    if (last) return { at: last.end, text: `${eol}${line}` };
    const at = TOP_LINES.exec(source)[0].length;
    return { at, text: /^\r?\n/.test(source.slice(at)) ? `${line}${eol}` : `${line}${eol}${eol}` };
}

// The config's source with the extension a module gives imported under name and called first in its extensions list,
// and the name its import binds, or null where it cannot place them safely: the default export must be an object
// literal and its extensions an array literal, without a spread after them that may carry a list of its own. A config
// that imports the module lists it under that import, and one that lists it already stays as it is.
export function withExtension(source, specifier, name) {
    const program = parseAst(source);
    const exported = program.body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration;
    if (exported?.type !== 'ObjectExpression') return null;
    const property = propertyOf(exported, 'extensions');
    const isSpreadAfter = exported.properties.slice(exported.properties.indexOf(property) + 1).some((node) => node.type === 'SpreadElement');
    if ((property && property.value.type !== 'ArrayExpression') || isSpreadAfter) return null;
    const list = property?.value;
    const imported = program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === specifier)
        ?.specifiers.find((specifierNode) => specifierNode.type === 'ImportDefaultSpecifier')?.local.name;
    const identifier = imported ?? freeName(name, namesIn(program));
    if (list?.elements.some(isCallOf(identifier))) return { source, identifier, isListed: true };
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const edits = [
        listEdit(source, eol, exported, list, `${identifier}()`),
        ...(imported ? [] : [importEdit(source, eol, program, identifier, specifier)]),
    ];
    // From the end, so each edit lands where the source had its place.
    const changed = edits.sort((a, b) => b.at - a.at).reduce((text, edit) => insert(text, edit.at, edit.text), source);
    return { source: changed, identifier, isListed: false };
}

export const configFileOf = (project) => CONFIG_EXTENSIONS.map((extension) => path.join(project, `crossbind.config.${extension}`))
    .find((candidate) => fs.existsSync(candidate));

// Writes the extension a module gives into the project's crossbind.config, and says under which name and whether the
// config listed it already, or null where it could not: a config the change would leave unreadable stays as it is.
export function writeExtension(project, specifier, name) {
    const file = configFileOf(project);
    if (!file) return null;
    const written = withExtension(fs.readFileSync(file, 'utf8'), specifier, name);
    if (written === null) return null;
    if (!written.isListed) {
        try {
            parseAst(written.source);
        } catch {
            return null;
        }
        fs.writeFileSync(file, written.source);
    }
    return { file, identifier: written.identifier, isListed: written.isListed };
}

// Writes the option a key's path names into the project's crossbind.config, and says whether it could: a config the
// change would leave unreadable stays as it is.
export function writeOption(project, keys, value) {
    const file = configFileOf(project);
    if (!file) return false;
    const changed = withOption(fs.readFileSync(file, 'utf8'), keys, value);
    if (changed === null) return false;
    try {
        parseAst(changed);
    } catch {
        return false;
    }
    fs.writeFileSync(file, changed);
    return true;
}

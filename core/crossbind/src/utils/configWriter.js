import fs from 'node:fs';
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
// A value as one writes it in a config by hand: { fileTimestamp: ['C617.1'] }.
function literal(value) {
    if (typeof value === 'string') return `'${value.replace(/[\\']/g, '\\$&')}'`;
    if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
    if (value !== null && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${key}: ${literal(item)}`).join(', ')} }`;
    return JSON.stringify(value);
}
export const entry = (key, value) => `${key}: ${literal(value)}`;

// How far an object's keys sit in from the line it opens on.
function indentUnit(source, object) {
    const [first] = object.properties;
    if (!first || isOneLine(source, object.start, first.start)) return DEFAULT_INDENT;
    return indentOf(source, first.start).slice(indentOf(source, object.start).length) || DEFAULT_INDENT;
}

// The config's source with `key: value` first in its app section, which it makes where there is none, or null where it
// cannot place it safely: the default export must be an object literal, its app one too, without the key or a spread.
export function withAppOption(source, key, value) {
    const exported = parseAst(source).body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration;
    if (exported?.type !== 'ObjectExpression') return null;
    const unit = indentUnit(source, exported);
    const text = entry(key, value);
    const app = propertyOf(exported, 'app');
    if (!app) {
        if (hasSpread(exported)) return null;
        const [first] = exported.properties;
        if (!first || isOneLine(source, exported.start, first.start)) return insert(source, exported.start + 1, ` app: { ${text} },`);
        const indent = indentOf(source, first.start);
        return insert(source, exported.start + 1, `\n${indent}app: {\n${indent}${unit}${text},\n${indent}},`);
    }
    if (app.value.type !== 'ObjectExpression' || propertyOf(app.value, key) || hasSpread(app.value)) return null;
    const [first] = app.value.properties;
    if (!first) {
        const indent = indentOf(source, app.start);
        return `${source.slice(0, app.value.start)}{\n${indent}${unit}${text},\n${indent}}${source.slice(app.value.end)}`;
    }
    if (isOneLine(source, app.value.start, first.start)) return insert(source, app.value.start + 1, ` ${text},`);
    return insert(source, app.value.start + 1, `\n${indentOf(source, first.start)}${text},`);
}

// Writes `key: value` into the project's crossbind.config, and says whether it could.
export function writeAppOption(project, key, value) {
    const file = CONFIG_EXTENSIONS.map((extension) => `${project}/crossbind.config.${extension}`).find((candidate) => fs.existsSync(candidate));
    if (!file) return false;
    const changed = withAppOption(fs.readFileSync(file, 'utf8'), key, value);
    if (changed === null) return false;
    fs.writeFileSync(file, changed);
    return true;
}

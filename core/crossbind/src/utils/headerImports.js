import fs from 'node:fs';
import appSourceFiles from './appSources.js';

// `import * as x` and `export *` take every name the header exports.
export const ALL_NAMES = '*';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// The clause shapes are spelled out, so a match cannot run from one statement into the next.
const HEADER_IMPORT = /\b(import|export)\s+(type\s+)?((?:[A-Za-z_$][\w$]*\s*,\s*)?(?:\{[^}]*\}|\*(?:\s*as\s+[A-Za-z_$][\w$]*)?)|[A-Za-z_$][\w$]*)\s*from\s*(['"])([^'"\n]+)\4/g;
// `import('x.h')`, `import 'x.h'` and `require('x.h')` hand the app the whole module. A lazy import may carry a bundler
// comment (`/* webpackChunkName: "x" */`) or a template literal. A comment ends at its first `*/`, so a run of them
// matches one way only.
const WHOLE_MODULE = /\b(?:import\s*\(\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/\s*)*|import\s+|require\s*\(\s*)(['"`])([^'"`$\n]+)\1/g;

// A comment runs to its first `*/`, or to the end when it never closes, so each is read once.
function listedNames(list) {
    return list.replace(/\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$)|\/\/[^\n]*/g, '').split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry && !/^type\s/.test(entry))
        .map((entry) => entry.split(/\s+as\s+/)[0])
        .filter((name) => name !== 'default' && IDENTIFIER.test(name));
}

// A specifier built at run time is not found.
export function findHeaderImports(text, headerExtensions) {
    const isHeader = new RegExp(`\\.(${headerExtensions.join('|')})$`);
    const listed = [...text.matchAll(HEADER_IMPORT)].flatMap(([, , type, clause, , specifier]) => {
        if (type || !isHeader.test(specifier)) return [];
        const open = clause.indexOf('{');
        const close = open === -1 ? -1 : clause.indexOf('}', open);
        const hasList = close !== -1;
        if ((hasList ? clause.slice(0, open) + clause.slice(close + 1) : clause).includes('*')) return [{ specifier, names: ALL_NAMES }];
        const names = listedNames(hasList ? clause.slice(open + 1, close) : '');
        return names.length ? [{ specifier, names }] : [];
    });
    const whole = [...text.matchAll(WHOLE_MODULE)]
        .filter(([, , specifier]) => isHeader.test(specifier))
        .map(([, , specifier]) => ({ specifier, names: ALL_NAMES }));
    return [...listed, ...whole];
}

const scanned = new Map();

// A source is read again only when its size or modification time changed.
export function findHeaderImportsIn(projectDir, headerExtensions) {
    const extensions = headerExtensions.join(',');
    return appSourceFiles(projectDir).flatMap((importer) => {
        const { mtimeMs, size } = fs.statSync(importer);
        const cached = scanned.get(importer);
        if (cached?.mtimeMs !== mtimeMs || cached.size !== size || cached.extensions !== extensions) {
            const imports = findHeaderImports(fs.readFileSync(importer, 'utf8'), headerExtensions);
            scanned.set(importer, { mtimeMs, size, extensions, imports });
        }
        return scanned.get(importer).imports.map((found) => ({ importer, ...found }));
    });
}

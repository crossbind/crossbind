import fs from 'node:fs';
import appSourceFiles from './appSources.js';

// `import * as x` and `export *` take every name the header exports.
export const ALL_NAMES = '*';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// The clause shapes are spelled out, so a match cannot run from one statement into the next.
const HEADER_IMPORT = /\b(import|export)\s+(type\s+)?((?:[A-Za-z_$][\w$]*\s*,\s*)?(?:\{[^}]*\}|\*(?:\s*as\s+[A-Za-z_$][\w$]*)?)|[A-Za-z_$][\w$]*)\s*from\s*(['"])([^'"\n]+)\4/g;

function listedNames(list) {
    return list.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry && !/^type\s/.test(entry))
        .map((entry) => entry.split(/\s+as\s+/)[0])
        .filter((name) => name !== 'default' && IDENTIFIER.test(name));
}

// A specifier built at run time is not found.
export function findHeaderImports(text, headerExtensions) {
    const isHeader = new RegExp(`\\.(${headerExtensions.join('|')})$`);
    return [...text.matchAll(HEADER_IMPORT)].flatMap(([, , type, clause, , specifier]) => {
        if (type || !isHeader.test(specifier)) return [];
        const list = clause.match(/\{([^}]*)\}/);
        if (clause.replace(list?.[0] ?? '', '').includes('*')) return [{ specifier, names: ALL_NAMES }];
        const names = listedNames(list?.[1] ?? '');
        return names.length ? [{ specifier, names }] : [];
    });
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

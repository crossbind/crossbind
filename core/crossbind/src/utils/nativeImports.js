import fs from 'node:fs';
import appSourceFiles from './appSources.js';

// Static imports and re-exports, side-effect imports, and import() or require() of a literal. A specifier
// built at run time is not found.
const IMPORT_SPECIFIER = /\b(?:from|import\s*\(?|require\s*\()\s*(['"])([^'"\n]+)\1/g;

export function findImportSpecifiers(text) {
    return [...new Set([...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[2]))];
}

export const nativeExtensions = ({ header, module }) => [...header, ...module, 'rs'];

export const nativeSpecifierTest = (ext) => {
    const extension = new RegExp(`\\.(${nativeExtensions(ext).join('|')})$`);
    return (specifier) => /^(cargo|conan):/.test(specifier) || extension.test(specifier);
};

export function findNativeImportsIn(projectDir, isNative) {
    return appSourceFiles(projectDir).flatMap((importer) => findImportSpecifiers(fs.readFileSync(importer, 'utf8'))
        .filter(isNative)
        .map((specifier) => ({ importer, specifier })));
}

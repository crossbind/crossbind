import fs from 'node:fs';
import appSourceFiles from './appSources.js';

// Static imports and re-exports, side-effect imports, and import() or require() of a literal. A specifier
// built at run time is not found.
const IMPORT_SPECIFIER = /\b(?:from|import\s*\(?|require\s*\()\s*(['"])([^'"\n]+)\1/g;

export function findImportSpecifiers(text) {
    return [...new Set([...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[2]))];
}

export const nativeExtensions = ({ header, module }) => [...header, ...module, 'rs'];

// Whether a specifier opens with one of the schemes an import names a store by, as cargo: and conan: are.
export const schemeTest = (schemes) => {
    const scheme = new RegExp(`^(${schemes.join('|')}):`);
    return (specifier) => scheme.test(specifier);
};

export const nativeSpecifierTest = (ext, schemes) => {
    const extension = new RegExp(`\\.(${nativeExtensions(ext).join('|')})$`);
    const hasScheme = schemeTest(schemes);
    return (specifier) => hasScheme(specifier) || extension.test(specifier);
};

export function findNativeImportsIn(projectDir, isNative) {
    return appSourceFiles(projectDir).flatMap((importer) => findImportSpecifiers(fs.readFileSync(importer, 'utf8'))
        .filter(isNative)
        .map((specifier) => ({ importer, specifier })));
}

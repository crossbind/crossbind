import { createRequire } from 'node:module';
import upath from 'upath';
import getDependFilePath from './getDependFilePath.js';

// A package that is not a crossbind dependency (the conformance kit) resolves the way the bundler finds it.
export default function resolveNativeImport(specifier, importer, target) {
    if (specifier.startsWith('.')) return upath.resolve(upath.dirname(importer), specifier);
    if (upath.isAbsolute(specifier)) return specifier;
    try {
        return getDependFilePath(specifier, target) ?? createRequire(importer).resolve(specifier);
    } catch (e) {
        return null;
    }
}

import fs from 'node:fs';
import upath from 'upath';
import state from '../state/index.js';
import createBridgeFile from '../actions/createInterface.js';
import resolveNativeImport from './resolveNativeImport.js';
import { isAppSource } from '../utils/appSources.js';
import { findHeaderImports } from '../utils/headerImports.js';

// Metro keeps a header's module as it first transformed it, so a source of the app that imports the header binds it
// again: the functions it names reach the next native build or page load.
export default function bindHeaderImports(source, file, target) {
    if (!isAppSource(state.config.paths.project, file)) return [];
    const headers = findHeaderImports(source, state.config.ext.header)
        .map(({ specifier }) => resolveNativeImport(specifier, file, target))
        .filter((header) => header && fs.existsSync(header))
        .map((header) => upath.normalize(header));
    return [...new Set(headers)].map((header) => createBridgeFile(header, target));
}

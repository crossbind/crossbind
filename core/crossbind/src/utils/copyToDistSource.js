import fs from 'node:fs';
import { createRequire } from 'node:module';
import upath from 'upath';

const NODE_MODULES = 'node_modules/';

// A copyToDist source names another package's file as node_modules/<package>/<file>. npm may hoist that package
// above the one being built, so a path missing beside the package resolves the way Node finds the package.
export default function copyToDistSource(projectDir, key) {
    const local = upath.join(projectDir, key);
    if (fs.existsSync(local) || !key.startsWith(NODE_MODULES)) return local;
    return upath.normalize(createRequire(upath.join(projectDir, 'package.json')).resolve(key.slice(NODE_MODULES.length)));
}

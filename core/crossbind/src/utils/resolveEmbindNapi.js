import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import createCompanionResolver from './resolveCompanionPackage.js';

const PKG = '@crossbind/core-embind-napi';

const resolveEmbindNapiRoot = createCompanionResolver({
    pkg: PKG,
    siblingDir: 'embind-napi',
    siblingMarker: 'cpp/src/node_api_module.cpp',
    missingMessage: `crossbind: native Node.js builds need ${PKG} - add it to your devDependencies.`,
});

export default resolveEmbindNapiRoot;

// The embind runtime itself ships in @crossbind/core-embind-jsi, a dependency of the Node-API
// package, so it resolves from there.
export function resolveEmbindJsiRoot() {
    const req = createRequire(path.join(resolveEmbindNapiRoot(), 'package.json'));
    return path.dirname(fs.realpathSync(req.resolve('@crossbind/core-embind-jsi/package.json')));
}

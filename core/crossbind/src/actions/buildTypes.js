import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import findFiles from '../utils/findFiles.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { parseCppSurface, emitCppDts } from '../utils/cppDts.js';
import logger from '../utils/logger.js';

// Package type publishing (opt-in: config `types: true`): one combined .d.ts over every
// public header, written to <output>/types/index.d.ts, and package.json wired the way
// hand-maintained typings already are - `types` plus a greedy `typesVersions` "*.h" map -
// so a consumer's `import ... from '<pkg>/<any>.h'` resolves to the generated file. The other
// paths a package maps, such as its node/napi entry, stay.
export function withPackageTypes(manifest, relative) {
    const versions = manifest.typesVersions ?? {};
    return { ...manifest, types: relative, typesVersions: { ...versions, '*': { ...versions['*'], '*.h': [relative] } } };
}

export default function buildTypes() {
    if (state.config.types !== true) return;
    const exts = state.config.ext.header.join(',');
    const headers = [...new Set(state.config.paths.header.flatMap((dir) => findFiles(`${dir}/**/*.{${exts}}`)))].sort();
    if (headers.length === 0) return;

    const combined = headers.map((h) => fs.readFileSync(h, 'utf8')).join('\n');
    const model = parseCppSurface(combined, (m) => logger.info(m));
    const names = model.classes.map((c) => c.name);
    const dtsFile = `${state.config.paths.output}/types/index.d.ts`;
    writeIfChanged(dtsFile, emitCppDts(model, names, state.config.dts));

    const manifestFile = `${state.config.paths.project}/package.json`;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const relative = `./${path.relative(state.config.paths.project, dtsFile)}`;
    const next = withPackageTypes(manifest, relative);
    if (JSON.stringify({ t: next.types, v: next.typesVersions }) !== JSON.stringify({ t: manifest.types, v: manifest.typesVersions })) {
        fs.writeFileSync(manifestFile, `${JSON.stringify(next, null, 4)}\n`);
    }
    logger.info(`crossbind: package types -> ${relative} (${names.length} classes from ${headers.length} headers)`);
}

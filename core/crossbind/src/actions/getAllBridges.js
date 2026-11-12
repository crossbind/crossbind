import fs from 'node:fs';
import path from 'node:path';
import findFiles from '../utils/findFiles.js';
import state from '../state/index.js';
import { declarationOf, dependenciesOf, sourceImportOfHeader } from '../utils/packageSourceImport.js';

// Why a bridge's header can no longer be included, or null. A package source's stage outlives the declaration, and
// the source itself, so the header of a package the project no longer declares is still there while its include
// directory is off the compile. The stage is named by the path, as the project may have dropped the source too.
function staleReasonOf(header) {
    if (!fs.existsSync(header)) return 'its header is gone';
    const { config } = state;
    const stages = `${config.paths.cache}/`;
    const [source] = header.startsWith(stages) ? header.slice(stages.length).split('/') : [];
    const staged = source ? sourceImportOfHeader(header, config.paths.cache, [source]) : null;
    if (!staged || Object.hasOwn(dependenciesOf(config, source), staged.name)) return null;
    return `${declarationOf(source)} no longer declares ${staged.name}`;
}

export default function getAllBridges(log = console.log) {
    return findFiles(`${state.config.paths.build}/bridge/*.i.cpp`).filter((bridge) => {
        // The .source sidecar records the header this bridge was generated from. When that
        // header can no longer be included, the stale .i.cpp would #include a missing file and
        // break the native build - the same failure a deleted .rs used to cause. Bridges without
        // a sidecar predate it and are left alone.
        const sidecar = `${bridge}.source`;
        if (!fs.existsSync(sidecar)) return true;
        const source = fs.readFileSync(sidecar, 'utf8').trim();
        const reason = source ? staleReasonOf(source) : null;
        if (!reason) return true;
        [bridge, `${bridge}.exports.json`, `${bridge}.deps`, `${bridge}.warnings`, sidecar].forEach((f) => fs.rmSync(f, { force: true }));
        log(`crossbind: pruned stale bridge '${path.basename(bridge)}' - ${reason}`);
        return false;
    });
}

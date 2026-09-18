import fs from 'node:fs';
import path from 'node:path';
import findFiles from '../utils/findFiles.js';
import state from '../state/index.js';

export default function getAllBridges(log = console.log) {
    return findFiles(`${state.config.paths.build}/bridge/*.i.cpp`).filter((bridge) => {
        // The .source sidecar records the header this bridge was generated from. When that
        // header is gone, the stale .i.cpp would #include a missing file and break the native
        // build - the same failure a deleted .rs used to cause. Bridges without a sidecar
        // predate it and are left alone.
        const sidecar = `${bridge}.source`;
        if (!fs.existsSync(sidecar)) return true;
        const source = fs.readFileSync(sidecar, 'utf8').trim();
        if (!source || fs.existsSync(source)) return true;
        [bridge, `${bridge}.exports.json`, `${bridge}.deps`, sidecar].forEach((f) => fs.rmSync(f, { force: true }));
        log(`crossbind: pruned stale bridge '${path.basename(bridge)}' - its header is gone`);
        return false;
    });
}

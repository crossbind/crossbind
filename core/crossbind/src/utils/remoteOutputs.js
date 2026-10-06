import fs from 'node:fs';
import path from 'node:path';
import { hostPathOf, isDeclaredOutput, modeOf } from '../runner/files.js';

// Where a file the runner hands back may land: below an output root the step declared, and in a store
// unit only when this machine does not hold it yet. `present` lists those units per mount.
export function outputTarget(mounts, present, containerPath) {
    const target = hostPathOf(mounts, containerPath);
    if (!isDeclaredOutput(target.rel, target.mount.outputRoots, present[mounts.indexOf(target.mount)])) {
        throw new Error(`crossbind: the remote runner returned ${containerPath}, which is not an output of this step.`);
    }
    return target;
}

// A link inside the project must not carry a write or a delete out of it.
function assertStaysInside(target) {
    fs.mkdirSync(target.mount.host, { recursive: true });
    const root = fs.realpathSync(target.mount.host);
    let dir = path.dirname(target.file);
    while (!fs.existsSync(dir)) dir = path.dirname(dir);
    const real = fs.realpathSync(dir);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
        throw new Error(`crossbind: ${target.file} leads out of ${target.mount.host} through a link, so the remote runner's output stays unwritten.`);
    }
}

export function writeOutputFile(target, data, mode) {
    assertStaysInside(target);
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    // A link at the output's own path is replaced, never written through.
    if (fs.lstatSync(target.file, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(target.file);
    fs.writeFileSync(target.file, data);
    fs.chmodSync(target.file, modeOf(mode));
}

export function removeOutputFile(target) {
    assertStaysInside(target);
    fs.rmSync(target.file, { force: true });
}

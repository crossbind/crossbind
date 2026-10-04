import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import getOsUserAndGroupId from './getOsUserAndGroupId.js';

function samePath(a, b) {
    const real = (p) => {
        try {
            return fs.realpathSync(p);
        } catch {
            return path.resolve(p);
        }
    };
    return real(a) === real(b);
}

// docker exec attaches to a container the user created, so nothing else checks what it mounts. A
// container without a tool's cache mount keeps that cache inside itself, where the host reads paths
// that were never written: fail first, with the way to fix it.
export default function assertExecContainer({ name, mounts, workdir, hint, mountNote }) {
    let info;
    try {
        // stderr is dropped: docker's own "No such container" would land before the message below.
        info = JSON.parse(execFileSync('docker', ['container', 'inspect', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0];
    } catch {
        throw new Error(`crossbind: RUNNER=DOCKER_EXEC needs a container named '${name}', which does not exist.\n${hint}`);
    }
    if (!info?.State?.Running) {
        throw new Error(
            `crossbind: the container '${name}' exists but is not running. Start it with \`docker start ${name}\`, or recreate it.\n${hint}`,
        );
    }
    for (const [destination, source] of mounts) {
        const mount = (info.Mounts ?? []).find((m) => m.Destination === destination);
        if (!mount || !samePath(mount.Source, source)) {
            const found = mount ? ` - it mounts ${mount.Source} there` : '';
            throw new Error(
                `crossbind: the container '${name}' does not mount ${source} at ${destination}${found}. ${mountNote}\n${hint}`,
            );
        }
    }
    // `docker run --workdir` creates the directory; `docker exec --workdir` does not, and the tool
    // dies with an OCI "chdir to cwd" error that names nothing the user can act on.
    try {
        execFileSync('docker', ['exec', '--user', getOsUserAndGroupId(), name, 'mkdir', '-p', workdir], { stdio: 'ignore' });
    } catch (e) {
        throw new Error(`crossbind: could not create the working directory ${workdir} inside '${name}'.\n${hint}`, { cause: e });
    }
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node-only: reads the export list crossbind writes next to each kit bridge.
export function kitExports(bridgeDir) {
    const kitDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'native');
    const names = new Set();
    for (const header of fs.readdirSync(kitDir).filter((file) => file.endsWith('.h'))) {
        const file = path.join(bridgeDir, `${header.replace(/\.h$/, '')}.i.cpp.exports.json`);
        if (!fs.existsSync(file)) throw new Error(`no bridge exports for ${header}: ${file}`);
        for (const name of JSON.parse(fs.readFileSync(file, 'utf8'))) names.add(name);
    }
    return [...names];
}

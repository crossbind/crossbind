import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// npm installed the addon of this machine; it loads from CommonJS and from ESM alike.
const EXPECTED = '= 6*J₃';

for (const entry of ['src/index.js', 'src/index.mjs']) {
    const out = execFileSync(process.execPath, [entry], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    process.stdout.write(out);
    if (!out.includes(EXPECTED)) {
        console.error(`FAIL: ${entry} did not print "${EXPECTED}"`);
        process.exit(1);
    }
}

// Starts the app through crossbind/node/dev: the first start builds, a start with nothing changed does not, and a
// native source added or removed builds again.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const expected = /^NATIVE J₃ \* \(2\*J₃\) = 6\*J₃ \| ANSWER 42 \| MATRIX 12 \| ZLIB 1\.3\.2 1013 \| RUST 42 true$/m;
const BUILT = 'native sources changed since the last build';
const PROBE = 'src/native/dev-probe.h';
const START_TIMEOUT_MS = 600000;

let failed = false;
function check(label, entry, { builds }) {
    const { stdout, stderr, status } = spawnSync(process.execPath, ['--import', 'crossbind/node/dev', entry], { encoding: 'utf8', timeout: START_TIMEOUT_MS });
    const ok = status === 0 && expected.test(stdout) && stderr.includes(BUILT) === builds;
    failed ||= !ok;
    console.log(`${ok ? 'ok' : 'FAIL'}: ${label}${ok ? '' : `\n${stdout}${stderr}`}`);
}

fs.rmSync('.crossbind/node-dev', { recursive: true, force: true });
try {
    check('the first start builds', 'src/index.mjs', { builds: true });
    check('a start with nothing changed does not', 'src/index.mjs', { builds: false });
    check('a CommonJS app starts the same way', 'src/index.cjs', { builds: false });
    fs.writeFileSync(PROBE, 'inline int devProbe() { return 7; }\n');
    check('a new native source builds again', 'src/index.mjs', { builds: true });
} finally {
    fs.rmSync(PROBE, { force: true });
}
check('so does removing it', 'src/index.mjs', { builds: true });
process.exit(failed ? 1 : 0);

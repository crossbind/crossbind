// Runs both entries under the hooks of every binary the build wrote: the wasm module and the Node-API addon.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const expected = /^NATIVE J₃ \* \(2\*J₃\) = 6\*J₃ \| ANSWER 42 \| MATRIX 12 \| ZLIB 1\.3\.2 1013 \| RUST 42 true$/m;
const formats = ['wasm', 'napi'].filter((format) => fs.existsSync(`dist/node/${format}.register.mjs`));
if (formats.length === 0) {
    console.error('no dist/node/*.register.mjs - run the build first');
    process.exit(1);
}

let failed = false;
for (const format of formats) {
    for (const entry of ['src/index.mjs', 'src/index.cjs']) {
        const out = execFileSync('node', ['--import', `./dist/node/${format}.register.mjs`, entry], { encoding: 'utf8', timeout: 60000 });
        const ok = expected.test(out);
        failed ||= !ok;
        console.log(`${ok ? 'ok' : 'FAIL'}: ${format} ${entry}${ok ? '' : `\n${out}`}`);
    }
}
process.exit(failed ? 1 : 0);

import { execFile } from 'node:child_process';

// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const conformance = /^CONFORMANCE (\d+)\/\1\b.*$/m;

execFile('node', ['src/index.mjs'], { timeout: 120000 }, (err, stdout, stderr) => {
    const out = `${stdout}\n${stderr}`;
    if (err) {
        console.error(out);
        console.error('run failed:', err.message);
        process.exit(1);
    }
    if (!conformance.test(out)) {
        console.error(`conformance failed:\n${out}`);
        process.exit(1);
    }
    console.log('ok:', out.match(conformance)[0]);
});

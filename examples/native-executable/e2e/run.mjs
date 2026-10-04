import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Runs the executables this machine runs. The musl one is fully static, so Linux runs it whatever
// its C library.
const EXPECTED = '= 6*J₃';
const RUNNABLE = { linux: ['linux', 'linuxmusl'], darwin: ['darwin'], win32: ['win32'] }[process.platform] ?? [];

const dist = resolve(import.meta.dirname, '../dist');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const executables = RUNNABLE.map((platform) => `crossbind-example-native-executable.${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`);

const missing = executables.filter((file) => !existsSync(join(dist, file)));
if (executables.length === 0 || missing.length > 0) {
    console.error(`FAIL: ${missing.join(', ') || `no executable runs on ${process.platform}`} missing - run \`pnpm build\` first.`);
    process.exit(1);
}
for (const file of executables) {
    const out = execFileSync(join(dist, file), { encoding: 'utf8' });
    process.stdout.write(out);
    if (!out.includes(EXPECTED)) {
        console.error(`FAIL: ${file} did not print "${EXPECTED}"`);
        process.exit(1);
    }
}

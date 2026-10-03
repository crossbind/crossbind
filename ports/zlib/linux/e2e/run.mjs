import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Compile e2e/main.c against the shipped archive with the stock gcc of a glibc 2.28 image, through
// the relocated pkg-config file, and run it there.
const IMAGE = 'gcc:8';
const RUN_TIMEOUT_MS = 300000;
const pkgDir = resolve(import.meta.dirname, '..');
const { nativeVersion } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const prebuilt = join(pkgDir, 'dist/prebuilt', `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-mt-release`);

if (!existsSync(prebuilt)) {
    console.log('SKIP: linux prebuilt missing - run `pnpm build` first.');
    process.exit(0);
}
try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: docker not available - linux consumer e2e not run.');
    process.exit(0);
}

const script = [
    'set -e',
    'export PKG_CONFIG_PATH=/prebuilt/lib/pkgconfig',
    'cc -O2 /e2e/main.c -o /tmp/main $(pkg-config --cflags --libs zlib)',
    '/tmp/main',
].join('\n');
const out = execFileSync('docker', [
    'run', '--rm', '-v', `${prebuilt}:/prebuilt:ro`, '-v', `${join(pkgDir, 'e2e')}:/e2e:ro`, IMAGE, 'sh', '-c', script,
], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
process.stdout.write(out);
// The image carries an older zlib of its own, so the version shows which archive was linked.
const marker = `zlib ${nativeVersion}: PASS`;
if (!out.includes(marker)) {
    console.error(`FAIL: missing "${marker}"`);
    process.exit(1);
}

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// GEOS is C++ built against libc++, so a consumer links it with clang and libc++: here the stock
// clang 19 and libc++ 19 of a Debian image, through the relocated pkg-config file.
const IMAGE = 'debian:trixie';
const RUN_TIMEOUT_MS = 600000;
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
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -qq',
    'apt-get install -y -qq --no-install-recommends clang-19 libc++-19-dev libc++abi-19-dev pkg-config >/dev/null',
    'export PKG_CONFIG_PATH=/prebuilt/lib/pkgconfig',
    'clang-19 -O2 -c /e2e/main.c -o /tmp/main.o $(pkg-config --cflags geos)',
    'clang++-19 -stdlib=libc++ /tmp/main.o -o /tmp/main $(pkg-config --static --libs geos)',
    '/tmp/main',
].join('\n');
const out = execFileSync('docker', [
    'run', '--rm', '-v', `${prebuilt}:/prebuilt:ro`, '-v', `${join(pkgDir, 'e2e')}:/e2e:ro`, IMAGE, 'sh', '-c', script,
], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
process.stdout.write(out);
const marker = `geos ${nativeVersion}`;
if (!out.includes(marker) || !out.includes(': PASS')) {
    console.error(`FAIL: missing "${marker}...: PASS"`);
    process.exit(1);
}

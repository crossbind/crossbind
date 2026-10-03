import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs each executable where it claims to run: the glibc one on Debian 10 (glibc 2.28), the static
// musl one on Alpine and on Debian alike, the macOS one on a macOS host. The Windows one is only
// checked for the machine it targets: nothing here runs it.
const RUN_TIMEOUT_MS = 300000;
const PT_INTERP = 3;
const PE_HEADER_OFFSET = 0x3c;
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };
const GLIBC_IMAGE = 'debian:10';
const MUSL_IMAGES = ['alpine:3.21', 'debian:trixie'];
const SYSTEM_LIBRARY = /^(linux-vdso|libdl|libpthread|libm|libc|libgcc_s|librt|\/lib\/ld-linux|\/lib64\/ld-linux)/;

const dist = resolve(import.meta.dirname, '../dist');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const executableOf = (platform) => `crossbind-e2e-cli-native.${platform}-${arch}`;
const { nativeVersion } = createRequire(import.meta.url)('@crossbind/port-zlib-linux/package.json');
const markers = ['argv[1]=merhaba', 'fs roundtrip: PASS', 'exceptions: PASS', `zlib ${nativeVersion}: PASS`];

function check(label, out) {
    process.stdout.write(out);
    const missing = markers.filter((marker) => !out.includes(marker));
    if (missing.length > 0) {
        console.error(`FAIL: ${label} is missing ${missing.map((marker) => `"${marker}"`).join(', ')}`);
        process.exit(1);
    }
    console.log(`ok: ${label}`);
}

function isDockerAvailable() {
    try {
        execFileSync('docker', ['info'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// The image variant must match the executable, whichever one an earlier pull left under the tag.
const inContainer = (image, script) => execFileSync('docker', [
    'run', '--rm', '--platform', `linux/${arch === 'arm64' ? 'arm64' : 'amd64'}`,
    '-v', `${dist}:/dist:ro`, '-w', '/tmp', image, 'sh', '-c', script,
], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });

// ELF64, little endian on both arches: a dynamically linked program names its loader in PT_INTERP.
function hasInterpreter(file) {
    const elf = readFileSync(file);
    const offset = Number(elf.readBigUInt64LE(0x20));
    const entrySize = elf.readUInt16LE(0x36);
    return Array.from({ length: elf.readUInt16LE(0x38) }, (_, index) => elf.readUInt32LE(offset + index * entrySize))
        .includes(PT_INTERP);
}

function checkGlibc() {
    const executable = `/dist/${executableOf('linux')}`;
    check(`linux-${arch} on ${GLIBC_IMAGE}`, inContainer(GLIBC_IMAGE, `${executable} merhaba`));
    const unexpected = inContainer(GLIBC_IMAGE, `ldd ${executable}`).split('\n').map((line) => line.trim())
        .filter((line) => line && !SYSTEM_LIBRARY.test(line));
    if (unexpected.length > 0) {
        console.error(`FAIL: linux-${arch} needs more than the C library: ${unexpected.join('; ')}`);
        process.exit(1);
    }
}

function checkMusl() {
    if (hasInterpreter(join(dist, executableOf('linuxmusl')))) {
        console.error(`FAIL: linuxmusl-${arch} is dynamically linked`);
        process.exit(1);
    }
    for (const image of MUSL_IMAGES) {
        check(`linuxmusl-${arch} on ${image}`, inContainer(image, `/dist/${executableOf('linuxmusl')} merhaba`));
    }
}

function checkWindows() {
    const pe = readFileSync(join(dist, `${executableOf('win32')}.exe`));
    const header = pe.readUInt32LE(PE_HEADER_OFFSET);
    if (pe.toString('latin1', header, header + 4) !== 'PE\0\0' || pe.readUInt16LE(header + 4) !== PE_MACHINE[arch]) {
        console.error(`FAIL: win32-${arch}.exe is not a Windows executable for ${arch}`);
        process.exit(1);
    }
    console.log(`ok: win32-${arch}.exe targets ${arch}`);
}

function checkDarwin() {
    const cwd = mkdtempSync(join(tmpdir(), 'crossbind-native-'));
    try {
        check(`darwin-${arch} on this host`, execFileSync(join(dist, executableOf('darwin')), ['merhaba'], { cwd, encoding: 'utf8' }));
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}

for (const file of [executableOf('linux'), executableOf('linuxmusl'), `${executableOf('win32')}.exe`]) {
    if (!existsSync(join(dist, file))) {
        console.error(`FAIL: ${file} missing - run \`pnpm build\` first.`);
        process.exit(1);
    }
}
checkWindows();
if (isDockerAvailable()) {
    checkGlibc();
    checkMusl();
} else {
    console.log('SKIP: docker not available - the Linux executables were not run.');
}
if (process.platform === 'darwin' && existsSync(join(dist, executableOf('darwin')))) checkDarwin();

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import config from '../crossbind.config.mjs';

// Runs each addon where Node.js loads it: the glibc one on Debian, the musl one on Alpine, the
// Windows and macOS ones on such a host. Every host also reads the Linux and Windows addons: the
// machine each one targets and, for Windows, the DLLs it loads and the symbols it exports.
const RUN_TIMEOUT_MS = 300000;
const ARCHS = ['x64', 'arm64'];
const GLIBC_IMAGE = 'node:24-bookworm-slim';
const MUSL_IMAGE = 'node:24-alpine';
const SYSTEM_LIBRARY = /^(linux-vdso\.so|lib(c|dl|m|pthread|rt|gcc_s)\.so|\/lib(64)?\/ld-linux)/;
const WINDOWS_DLL = /^(api-ms-win-crt-[a-z]+-l1-1-0|kernel32|advapi32|ws2_32|bcrypt|iphlpapi)\.dll$/i;
const NODE_API_EXPORTS = ['napi_register_module_v1', 'node_api_module_get_api_version_v1'];
const ELF_MACHINE = { x64: 0x3e, arm64: 0xb7 };
const PE_HEADER_OFFSET = 0x3c;
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const addonOf = (platform, addonArch = arch) => `${config.general.name}.${platform}-${addonArch}.node`;
const { zlib, libpng, libcurl } = config.conanDependencies;
const markers = [
    `zlib ${zlib}`, `libpng ${libpng}`, `libcurl ${libcurl.version}`,
    'crc32: PASS', 'fmt: PASS', 'exceptions: PASS', 'file fetch: PASS',
];

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

function check(label, out) {
    process.stdout.write(out);
    const missing = markers.filter((marker) => !out.includes(marker));
    if (missing.length > 0) fail(`${label} is missing ${missing.map((marker) => `"${marker}"`).join(', ')}`);
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

// The image variant must match the addon, whichever one an earlier pull left under the tag.
const inContainer = (image, script) => execFileSync('docker', [
    'run', '--rm', '--platform', `linux/${arch === 'arm64' ? 'arm64' : 'amd64'}`,
    '-v', `${root}:/fixture:ro`, '-w', '/fixture', image, 'sh', '-c', script,
], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });

const runHere = (platform) => check(`${platform}-${arch} on this host`, execFileSync(
    process.execPath, ['src/index.mjs'], { cwd: root, encoding: 'utf8', timeout: RUN_TIMEOUT_MS },
));

// ELF64 little endian on both arches: e_machine sits at 0x12.
function checkElf(platform, addonArch) {
    const addon = addonOf(platform, addonArch);
    const elf = readFileSync(join(dist, addon));
    if (elf.toString('latin1', 0, 4) !== '\x7fELF' || elf.readUInt16LE(0x12) !== ELF_MACHINE[addonArch]) {
        fail(`${addon} is not an ELF file for ${addonArch}`);
    }
    console.log(`ok: ${addon} targets ${addonArch}`);
}

// A PE32+ file (x64 and arm64): the COFF header follows the PE signature, the optional header
// follows the COFF header, and its data directories 0 and 1 locate the export and import tables.
function readPe(file) {
    const pe = readFileSync(file);
    const signature = pe.readUInt32LE(PE_HEADER_OFFSET);
    if (pe.toString('latin1', signature, signature + 4) !== 'PE\0\0') fail(`${file} is not a PE file`);
    const coff = signature + 4;
    const optional = coff + 20;
    const sectionTable = optional + pe.readUInt16LE(coff + 16);
    const sections = Array.from({ length: pe.readUInt16LE(coff + 2) }, (_, index) => sectionTable + index * 40)
        .map((section) => ({ address: pe.readUInt32LE(section + 12), size: pe.readUInt32LE(section + 16), offset: pe.readUInt32LE(section + 20) }));
    const offsetOf = (rva) => {
        const section = sections.find(({ address, size }) => rva >= address && rva < address + size);
        if (!section) fail(`${file} points outside its sections`);
        return rva - section.address + section.offset;
    };
    const nameAt = (rva) => pe.toString('latin1', offsetOf(rva), pe.indexOf(0, offsetOf(rva)));
    const directory = (index) => offsetOf(pe.readUInt32LE(optional + 112 + index * 8));
    const dlls = [];
    for (let descriptor = directory(1); pe.readUInt32LE(descriptor + 12) !== 0; descriptor += 20) {
        dlls.push(nameAt(pe.readUInt32LE(descriptor + 12)));
    }
    const names = offsetOf(pe.readUInt32LE(directory(0) + 32));
    const symbols = Array.from({ length: pe.readUInt32LE(directory(0) + 24) }, (_, index) => nameAt(pe.readUInt32LE(names + index * 4)));
    return { machine: pe.readUInt16LE(coff), dlls, symbols };
}

function checkWindows(addonArch) {
    const addon = addonOf('win32', addonArch);
    const { machine, dlls, symbols } = readPe(join(dist, addon));
    if (machine !== PE_MACHINE[addonArch]) fail(`${addon} is not a Windows addon for ${addonArch}`);
    const unexpected = dlls.filter((dll) => !WINDOWS_DLL.test(dll));
    if (unexpected.length > 0) fail(`${addon} loads ${unexpected.join(', ')}, which Windows does not ship`);
    if (symbols.join() !== NODE_API_EXPORTS.join()) fail(`${addon} exports ${symbols.join(', ')}`);
    console.log(`ok: ${addon} targets ${addonArch}, loads system DLLs only and exports the Node-API entry points only`);
}

function checkGlibc() {
    check(`linux-${arch} on ${GLIBC_IMAGE}`, inContainer(GLIBC_IMAGE, 'node src/index.mjs'));
    const unexpected = inContainer(GLIBC_IMAGE, `ldd dist/${addonOf('linux')}`).split('\n').map((line) => line.trim())
        .filter((line) => line && !SYSTEM_LIBRARY.test(line));
    if (unexpected.length > 0) fail(`linux-${arch} needs more than the C library: ${unexpected.join('; ')}`);
}

const addons = ['linux', 'linuxmusl', 'win32'].flatMap((platform) => ARCHS.map((addonArch) => addonOf(platform, addonArch)));
for (const file of [...addons, `${config.general.name}.native.cjs`]) {
    if (!existsSync(join(dist, file))) fail(`${file} missing - run \`pnpm build\` first.`);
}
ARCHS.forEach((addonArch) => {
    checkElf('linux', addonArch);
    checkElf('linuxmusl', addonArch);
    checkWindows(addonArch);
});
if (process.platform === 'win32') {
    runHere('win32');
} else if (isDockerAvailable()) {
    checkGlibc();
    check(`linuxmusl-${arch} on ${MUSL_IMAGE}`, inContainer(MUSL_IMAGE, 'node src/index.mjs'));
} else if (process.env.CI) {
    fail('docker is not available, so the Linux addons cannot run');
} else {
    console.log('SKIP: docker not available - the Linux addons were not run.');
}
if (process.platform === 'darwin' && existsSync(join(dist, addonOf('darwin')))) runHere('darwin');

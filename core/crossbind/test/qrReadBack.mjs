// The QR encoder's matrices, read back by macOS's own QR reader (CoreImage, through qrReadBack.swift): each of versions
// 1 to 6 at its full capacity with each of the eight masks, and a session's link with the version and mask the encoder
// chooses, must read back as encoded, and two codes broken on purpose must not. Their SHA-256 are then compared with
// qrMatrices.js, the expected values of qrMatrix.test.js, which runs on every system; --write writes them there, once
// every code has read back. macOS alone.
// usage: node test/qrReadBack.mjs [--write]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import { qrMatrix } from '../src/utils/qrMatrix.js';

const READER = fileURLToPath(new URL('./qrReadBack.swift', import.meta.url));
const EXPECTED = fileURLToPath(new URL('./qrMatrices.js', import.meta.url));
// Each version's capacity at level M in bytes, filled from a made-up session link and made-up text.
const CAPACITY = [null, 14, 26, 42, 62, 84, 106];
const FILLER = 'https://crossbind.dev/open/?s=IRVUB8Fpwuh0lT_7NkiJ8Q&made-up=0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
const LINK = 'https://crossbind.dev/open/?s=IRVUB8Fpwuh0lT_7NkiJ8Q';
const NOTHING = '<nothing read>';

if (process.platform !== 'darwin') {
    process.stderr.write('qrReadBack.mjs reads codes back with CoreImage, which macOS alone has.\n');
    process.exit(1);
}

const rowsOf = (modules) => modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
const hashOf = (modules) => crypto.createHash('sha256').update(rowsOf(modules).join('\n')).digest('hex');

const versions = [1, 2, 3, 4, 5, 6].map((version) => ({ version, text: FILLER.slice(0, CAPACITY[version]) }));
const codes = versions.flatMap(({ version, text }) => [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => ({
    label: `v${version} m${mask} (${text.length} bytes, full)`, text, mustRead: true, ...qrMatrix(text, { version, mask }),
})));
const link = qrMatrix(LINK);
codes.push({ label: `a session's link (${LINK.length} bytes), version and mask chosen: v${link.version} m${link.mask}`, text: LINK, mustRead: true, ...link });

// The check's own control: the format of mask 3 over data masked with 5, and about a quarter of the data turned over,
// past what level M corrects (about 15%).
const [three, five] = [qrMatrix(LINK, { version: 4, mask: 3 }), qrMatrix(LINK, { version: 4, mask: 5 })];
const isFormat = (x, y) => (y === 8 && (x <= 8 || x >= three.size - 8)) || (x === 8 && (y <= 8 || y >= three.size - 8));
codes.push(
    { label: 'the format of mask 3 over data masked with 5', text: LINK, mustRead: false, modules: five.modules.map((row, y) => row.map((dark, x) => (isFormat(x, y) ? three.modules[y][x] : dark))) },
    { label: 'a quarter of the modules turned over', text: LINK, mustRead: false, modules: three.modules.map((row, y) => row.map((dark, x) => (x > three.size / 2 && y > three.size / 2 && !isFormat(x, y) ? !dark : dark))) },
);

const dir = fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-qr-'));
let read;
try {
    const file = upath.join(dir, 'matrices.txt');
    fs.writeFileSync(file, codes.map((code) => [`# ${code.label}`, ...rowsOf(code.modules)].join('\n')).join('\n'));
    read = execFileSync('swift', [READER, file], { encoding: 'utf8' }).trim().split('\n').map((line) => line.split('\t'));
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}

let passed = 0;
codes.forEach((code, at) => {
    const [label, text] = read[at] ?? [];
    const ok = label === code.label && (code.mustRead ? text === code.text : text !== code.text);
    passed += ok ? 1 : 0;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${code.label}: ${code.mustRead ? 'reads back' : 'must not read'}${text === code.text ? '' : ` -> ${text ?? NOTHING}`}\n`);
});
process.stdout.write(`${passed}/${codes.length} as they must be, by CoreImage's QR detector\n`);

const matrices = { link: { text: LINK, version: link.version, mask: link.mask, sha256: hashOf(link.modules) }, versions: versions.map(({ version, text }) => ({ version, text, sha256: codes.filter((code) => code.mustRead && code.version === version && code.text === text).map((code) => hashOf(code.modules)) })) };
const source = `// Written by qrReadBack.mjs --write, from codes macOS's own QR reader read back as encoded: the expected matrices of
// qrMatrix.test.js, each as the SHA-256 of its rows of 0 and 1, a version's in the order of its masks.
export const LINK = ${JSON.stringify(matrices.link)};

export const VERSIONS = [
${matrices.versions.map((each) => `    ${JSON.stringify(each)},`).join('\n')}
];
`;
const isSame = fs.existsSync(EXPECTED) && fs.readFileSync(EXPECTED, 'utf8') === source;
if (passed === codes.length && process.argv.includes('--write')) {
    fs.writeFileSync(EXPECTED, source);
    process.stdout.write(`wrote ${upath.basename(EXPECTED)}\n`);
} else {
    process.stdout.write(isSame ? `${upath.basename(EXPECTED)} holds these matrices\n` : `${upath.basename(EXPECTED)} holds other matrices: run again with --write once every code reads back\n`);
}
process.exitCode = passed === codes.length && (isSame || process.argv.includes('--write')) ? 0 : 1;

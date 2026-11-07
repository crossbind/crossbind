// The conformance headers on which the package is checked against the web image, and the commands both sides run for
// each, as crossbind runs them for a header's macro table and bridge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(ROOT, '..', '..');
export const PARITY = path.join(ROOT, '.parity');
export const NATIVE = path.join(REPO, 'e2e/conformance/native');

export const headers = () =>
    fs
        .readdirSync(NATIVE)
        .filter((file) => file.endsWith('.h'))
        .sort();
export const nameOf = (header) => path.basename(header, '.h');
export const caseDir = (header) => path.join(PARITY, nameOf(header));

export const predefinedArgs = (outputFile) => ['-x', 'c++', '-std=c++17', '-dM', '-E', '-o', outputFile, '/dev/null'];

export const macroArgs = (includes, outputFile) => [
    '-x',
    'c++',
    '-std=c++17',
    '-dM',
    '-E',
    '-DNDEBUG',
    `-I${NATIVE}`,
    ...includes.flatMap((header) => ['-include', header]),
    '-o',
    outputFile,
    '/dev/null',
];

export const swigArgs = (header, outputDir) => [
    '-c++',
    '-embind',
    '-cpperraswarn',
    '-o',
    path.join(outputDir, `${nameOf(header)}.i.cpp`),
    `-I${NATIVE}`,
    path.join(caseDir(header), `${nameOf(header)}.i`),
];

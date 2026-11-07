// Checks on a Mac that the package makes what reference.mjs had the web image make: with its SWIG the same bridge,
// files, messages and exit code for each conformance header, and with Xcode's clang the same macro tables.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { preprocessorArgs, swig } from '../index.js';
import { PARITY, REPO, caseDir, headers, macroArgs, nameOf, predefinedArgs, swigArgs } from './parity-cases.mjs';

const CLANG = '/usr/bin/clang';
// clang reads CPATH and CPLUS_INCLUDE_PATH despite -nostdinc; crossbind's runner passes neither.
const CLANG_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const BRIDGE_FILES = ['.i.cpp', '.i.cpp.exports.json', '.i.cpp.warnings'];
const NAMES_SHOWN = 3;

const readIfAny = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const clang = (args) => spawnSync(CLANG, args, { encoding: 'utf8', env: CLANG_ENV });
const failed = (status) => status !== 0;
const listed = (names) =>
    names.length
        ? `${names.slice(0, NAMES_SHOWN).join(', ')}${names.length > NAMES_SHOWN ? ` and ${names.length - NAMES_SHOWN} more` : ''}`
        : 'nothing';

function swigDifferences({ header, swigStatus }, local) {
    const dir = caseDir(header);
    const packageDir = path.join(dir, 'package');
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.mkdirSync(packageDir);
    const { status, output } = swig(swigArgs(header, packageDir), { cwd: packageDir });
    fs.writeFileSync(path.join(packageDir, 'swig.output'), output);
    return [
        ...(status === swigStatus ? [] : [`SWIG exits with ${status}, the image's with ${swigStatus}`]),
        ...['swig.output', ...BRIDGE_FILES.map((suffix) => nameOf(header) + suffix)]
            .filter((file) => readIfAny(path.join(packageDir, file)) !== local(readIfAny(path.join(dir, 'image', file))))
            .map((file) => `${file} differs`),
    ];
}

// clang lists a macro table in another order than em++, so the two compare as sets of lines.
function tableDifferences(clangFile, emFile) {
    const lines = (file) => new Set(readIfAny(file)?.split('\n').filter(Boolean) ?? []);
    const fromClang = lines(clangFile);
    const fromEm = lines(emFile);
    const only = (table, other) => [...table].filter((line) => !other.has(line)).map((line) => line.match(/^#define (\w+)/)?.[1] ?? line);
    const [emAlone, clangAlone] = [only(fromEm, fromClang), only(fromClang, fromEm)];
    return emAlone.length || clangAlone.length ? [`macro table differs: em++ alone defines ${listed(emAlone)}, clang ${listed(clangAlone)}`] : [];
}

function macroDifferences({ header, includes, macroStatus }) {
    const dir = caseDir(header);
    const file = path.join(dir, 'package.macros.h');
    const { status, stderr } = clang([...preprocessorArgs, ...macroArgs(includes, file)]);
    if (failed(status) !== failed(macroStatus)) return [`clang exits with ${status}, em++ with ${macroStatus}: ${stderr.trim().split('\n')[0]}`];
    return tableDifferences(file, path.join(dir, 'image.macros.h'));
}

function main() {
    const reference = JSON.parse(fs.readFileSync(path.join(PARITY, 'reference.json'), 'utf8'));
    const covered = reference.cases.map(({ header }) => header).join(', ');
    if (covered !== headers().join(', ')) {
        throw new Error(`crossbind: the references cover ${covered || 'no header'}, not the conformance headers: run scripts/reference.mjs again.`);
    }
    // The image ran in another checkout, whose path its files name.
    const local = (text) => text?.replaceAll(reference.root, REPO) ?? null;
    const predefinedFile = path.join(PARITY, 'package.predefined.h');
    const predefined = [
        ...(clang([...preprocessorArgs, ...predefinedArgs(predefinedFile)]).status === 0 ? [] : ['clang made no predefined macro table']),
        ...tableDifferences(predefinedFile, path.join(PARITY, 'image.predefined.h')),
    ];
    const results = reference.cases.map((entry) => ({ header: entry.header, swig: swigDifferences(entry, local), macros: macroDifferences(entry) }));
    const count = (kind) => results.filter((result) => !result[kind].length).length;
    console.log(
        `crossbind: with ${clang(['--version']).stdout.split('\n')[0]}, for ${results.length} conformance headers the package made the ` +
            `image's bridges for ${count('swig')} and its macro tables for ${count('macros')}; the predefined macro table is ` +
            `${predefined.length ? 'different' : 'the same'}.`,
    );
    [{ header: 'predefined', swig: [], macros: predefined }, ...results]
        .filter((result) => result.swig.length || result.macros.length)
        .forEach((result) => console.error(`  ${result.header}: ${[...result.swig, ...result.macros].join('; ')}`));
    if (predefined.length || results.some((result) => result.swig.length || result.macros.length)) process.exitCode = 1;
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

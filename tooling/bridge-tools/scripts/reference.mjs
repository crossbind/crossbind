// Makes in the web image what parity.mjs checks the package against: for each conformance header the interface
// crossbind writes, and the macro table and bridge the image's em++ and swig make.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { conformanceExport } from '../../../e2e/conformance/config.mjs';
import { DOCKER_RUN_SECURITY_ARGS } from '../../../core/crossbind/src/utils/dockerSecurity.js';
import { ALL_NAMES } from '../../../core/crossbind/src/utils/headerImports.js';
import { buildInterfaceContent, interfaceIncludes, parseMacroDump, selectSwigMacros } from '../../../core/crossbind/src/utils/swigInterface.js';
import { webImage } from './build.mjs';
import { NATIVE, PARITY, REPO, caseDir, headers, macroArgs, nameOf, predefinedArgs, swigArgs } from './parity-cases.mjs';

// docker run exits with 125 to 127 when it cannot run the command at all.
const DOCKER_FAILED = 125;
const image = webImage();

function inImage(cwd, command) {
    const result = spawnSync(
        'docker',
        [
            'run',
            '--rm',
            ...DOCKER_RUN_SECURITY_ARGS,
            '--user',
            `${process.getuid()}:${process.getgid()}`,
            '-v',
            `${REPO}:${REPO}`,
            '-w',
            cwd,
            image,
            'sh',
            '-c',
            'exec "$@" 2>&1',
            'sh',
            ...command,
        ],
        { encoding: 'utf8' },
    );
    if (result.error) throw result.error;
    if (result.status >= DOCKER_FAILED) throw new Error(`crossbind: docker could not run ${command[0]}: ${result.stdout}${result.stderr}`);
    return { status: result.status, output: result.stdout };
}

function referenceFor(header, predefined) {
    const dir = caseDir(header);
    const imageDir = path.join(dir, 'image');
    fs.mkdirSync(imageDir, { recursive: true });
    const prelude = conformanceExport.headerPrelude[header] ?? [];
    const includes = interfaceIncludes(header, prelude);
    const macroFile = path.join(dir, 'image.macros.h');
    const macros = inImage(dir, ['em++', ...macroArgs(includes, macroFile)]);
    // A header whose includes do not preprocess keeps the interface without macros, as in crossbind.
    const swigMacros =
        macros.status === 0
            ? selectSwigMacros({
                  headerText: fs.readFileSync(path.join(NATIVE, header), 'utf8'),
                  macros: parseMacroDump(fs.readFileSync(macroFile, 'utf8')),
                  predefined,
                  constants: ALL_NAMES,
              })
            : [];
    fs.writeFileSync(
        path.join(dir, `${nameOf(header)}.i`),
        buildInterfaceContent({
            moduleName: nameOf(header).toUpperCase(),
            headerPath: header,
            prelude,
            swigMacros,
            ignored: conformanceExport.ignoredDeclarations[header] ?? [],
            constants: ALL_NAMES,
        }),
    );
    const bridge = inImage(imageDir, ['swig', ...swigArgs(header, imageDir)]);
    fs.writeFileSync(path.join(imageDir, 'swig.output'), bridge.output);
    return { header, includes, macroStatus: macros.status, swigStatus: bridge.status };
}

function main() {
    fs.rmSync(PARITY, { recursive: true, force: true });
    fs.mkdirSync(PARITY, { recursive: true });
    const predefinedFile = path.join(PARITY, 'image.predefined.h');
    const predefined = inImage(PARITY, ['em++', ...predefinedArgs(predefinedFile)]);
    if (predefined.status !== 0) throw new Error(`crossbind: em++ made no predefined macro table: ${predefined.output}`);
    const predefinedMacros = parseMacroDump(fs.readFileSync(predefinedFile, 'utf8'));
    const cases = headers().map((header) => referenceFor(header, predefinedMacros));
    fs.writeFileSync(path.join(PARITY, 'reference.json'), `${JSON.stringify({ root: REPO, image, cases }, null, 4)}\n`);
    console.log(`crossbind: the web image made the macro tables and bridges of ${cases.length} conformance headers in ${PARITY}.`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

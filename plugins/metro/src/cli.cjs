#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { WEB_FILES, requireWebTargets, buildWebGlue } = require('./web.cjs');

const USAGE = 'usage: crossbind-metro prepare-web\n       crossbind-metro export-web [output-dir]';

// Metro resolves imports against the files it found when it started, so the Conan packages and cargo
// builds a web bundle needs are staged before `expo start --web` or `expo export`, as build_js.js
// stages them before the native bundles.
async function prepareWeb() {
    const crossbind = await import('crossbind');
    const { targetParams, release: target } = requireWebTargets(crossbind);
    await crossbind.buildDependencies({ targetParams: { ...targetParams, buildType: [target.buildType] } });
}

// Expo's export copies public/ before Metro bundles and runs nothing after it, so the wasm the web
// bundle boots is linked here, from the bridges that bundling wrote, and put next to the bundle.
async function exportWeb(outputDir) {
    const crossbind = await import('crossbind');
    const { targetParams, release: target } = requireWebTargets(crossbind);
    await buildWebGlue(crossbind, targetParams, target);
    fs.mkdirSync(outputDir, { recursive: true });
    WEB_FILES.forEach(({ name, output, isOptional }) => {
        const filePath = `${crossbind.state.config.paths.build}/${target[output]}`;
        if (isOptional && !fs.existsSync(filePath)) return;
        fs.copyFileSync(filePath, path.join(outputDir, name));
    });
    console.log(`crossbind: linked ${target.path} into ${outputDir}`);
    if (target.runtime === 'mt') {
        console.log(`crossbind: ${outputDir} holds a multithreaded build; serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.`);
    }
}

const [command, outputDir = 'dist'] = process.argv.slice(2);
const COMMANDS = {
    'prepare-web': () => prepareWeb(),
    'export-web': () => exportWeb(outputDir),
};
if (command === '--help' || command === '-h') {
    console.log(USAGE);
} else if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.error(USAGE);
    process.exitCode = 1;
} else {
    // Reported as the crossbind CLI reports a failure: one line, the whole stack with DEBUG=1.
    COMMANDS[command]().catch((error) => {
        const cause = error?.cause?.message ? `\n  caused by: ${error.cause.message.split('\n')[0]}` : '';
        console.error(process.env.DEBUG ? error : `${error?.message ?? error}${cause}`);
        process.exitCode = 1;
    });
}

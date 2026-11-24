#!/usr/bin/env node
const USAGE = 'usage: crossbind-metro prepare-web\n       crossbind-metro export-web [output-dir]';

const webApi = async () => (await import('crossbind')).integrationApi();

// Metro resolves imports against the files it found when it started, so the Conan packages and cargo
// builds a web bundle needs are staged before `expo start --web` or `expo export`, as build_js.js
// stages them before the native bundles.
async function prepareWeb() {
    const api = await webApi();
    await api.prepare(api.targets.release);
}

// Expo's export copies public/ before Metro bundles and runs nothing after it, so the wasm the web
// bundle boots is linked here, from the bridges that bundling wrote, and put next to the bundle.
async function exportWeb(outputDir) {
    const api = await webApi();
    const target = api.targets.release;
    await api.link(target, { prepare: true, allBridges: true });
    api.writeOutputs(target, outputDir);
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

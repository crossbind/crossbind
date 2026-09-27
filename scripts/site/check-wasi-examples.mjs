import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { channelDistTag } from '../release/resolve-site-release.mjs';

// Builds and runs the WASI examples the /ports/<family>/wasi/ pages show. Each one is copied to a
// scratch directory, installed from npm on the site's channel (the published -wasi package and
// crossbind), given the input files it declares and run command by command; what its wasmtime
// commands print must match the example's `expected`. Needs wasmtime on PATH; the build itself uses
// WASI_SDK_PATH or the crossbind Docker image.

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMOS_DIR = path.join(REPOSITORY_ROOT, 'landing', 'demos');
const SKIPPED = /(^|[/\\])(node_modules|\.crossbind|dist)([/\\]|$)/;

const log = (message) => process.stderr.write(`${message}\n`);

function run(command, cwd) {
    const result = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1' } });
    if (result.status !== 0)
        throw new Error(`\`${command}\` failed with exit code ${result.status}:\n${(result.stderr || result.stdout || '').slice(-2000)}`);
    return result.stdout;
}

// The example's package.json asks for `beta`; a site built from another channel checks that channel.
function pinDependencies(file, distTag) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
            if (range === 'beta') manifest[field][name] = distTag;
        }
    }
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 4)}\n`);
}

export async function checkWasiExamples({ channel, only = null } = {}) {
    if (spawnSync('wasmtime', ['--version']).status !== 0) {
        log('SKIP: wasmtime is not on PATH.');
        return [];
    }
    const distTag = channelDistTag(channel);
    const checked = [];
    for (const demo of fs
        .readdirSync(DEMOS_DIR)
        .filter((name) => name.startsWith('lib-'))
        .sort()) {
        if (only && !only.includes(demo)) continue;
        const source = path.join(DEMOS_DIR, demo, 'wasi');
        if (!fs.existsSync(path.join(source, 'example.js'))) continue;
        const example = await import(pathToFileURL(path.join(source, 'example.js')).href);
        const work = fs.mkdtempSync(path.join(os.tmpdir(), `crossbind-${demo}-wasi-`));
        try {
            fs.cpSync(source, work, { recursive: true, filter: (from) => !SKIPPED.test(path.relative(source, from)) });
            pinDependencies(path.join(work, 'package.json'), distTag);
            log(`${demo}: installing the WASI example against npm ${distTag}`);
            run('npm install --no-audit --no-fund', work);
            for (const [name, content] of Object.entries(example.input?.() ?? {})) fs.writeFileSync(path.join(work, name), content);
            const printed = example.commands.flatMap((command) => {
                const output = run(command, work);
                return command.startsWith('wasmtime ') ? output.trimEnd().split('\n') : [];
            });
            if (JSON.stringify(printed) !== JSON.stringify(example.expected)) {
                throw new Error(`${demo}: the WASI example printed ${JSON.stringify(printed)}, expected ${JSON.stringify(example.expected)}.`);
            }
            log(`${demo}: ok - ${printed.join(' | ')}`);
            checked.push(demo);
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    }
    return checked;
}

async function main(argv) {
    const valueOf = (flag) => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };
    const configFile = valueOf('--config');
    if (!configFile) throw new Error('usage: check-wasi-examples.mjs --config <release.config.js> [--only lib-a,lib-b]');
    const { default: config } = await import(pathToFileURL(path.resolve(configFile)).href);
    const only = valueOf('--only')?.split(',') ?? null;
    const checked = await checkWasiExamples({ channel: config.channel, only });
    log(`Checked ${checked.length} WASI example${checked.length === 1 ? '' : 's'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        log(error.message);
        process.exit(1);
    });
}
